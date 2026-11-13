#include "yag.h"
#include "yyjson.h"
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <string.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
static const char *env(const char *key, const char *fallback) { const char *v=getenv(key); return v && *v ? v : fallback; }

static int env_limit(const char *name,const char *fallback,unsigned max,unsigned *dest) {
    const char *value=env(name,fallback),*end=value;
    errno=0;
    unsigned long n=strtoul(value,(char **)&end,10);
    if(errno || end==value || *end || n>max) {
        fprintf(stderr,"Invalid bounded numeric setting: %s\n",name);
        return -1;
    }
    *dest=(unsigned)n;
    return 0;
}
static int valid_url(const char *url) {
    size_t n=strlen(url);
    return n && (!strncmp(url,"http://",7) || !strncmp(url,"https://",8))
        && !strpbrk(url,"\r\n?#") && url[n-1]!='/';
}
/* The default upstream remains the model-discovery authority. A replica may
 * declare a bounded list of supported model IDs to avoid sending it unknown
 * models. Unrestricted replicas retain legacy equivalent-inventory behavior.
 * The operator, not YAG, must verify semantic compatibility of model IDs. */
static int load_pool(yag_config *cfg) {
    const char *raw=getenv("YAG_UPSTREAM_POOL");
    if(!raw || !*raw)return 0;
    yyjson_doc *doc=yyjson_read(raw,strlen(raw),0);
    yyjson_val *root=doc?yyjson_doc_get_root(doc):NULL;
    int ok=yyjson_is_arr(root) && yyjson_arr_size(root)<=8;
    if(ok)for(size_t i=0;i<yyjson_arr_size(root);i++) {
        yyjson_val *entry=yyjson_arr_get(root,i);
        yyjson_val *url=yyjson_obj_get(entry,"url");
        yyjson_val *key=yyjson_obj_get(entry,"key_env");
        yyjson_val *models=yyjson_obj_get(entry,"models");
        if(!yyjson_is_obj(entry) || !yyjson_is_str(url)
            || !yyjson_get_len(url) || yyjson_get_len(url)>1024
            || strlen(yyjson_get_str(url))!=yyjson_get_len(url)
            || !valid_url(yyjson_get_str(url))
            || (key && (!yyjson_is_str(key) || !yyjson_get_len(key)
                || strlen(yyjson_get_str(key))!=yyjson_get_len(key)))
            || (models && (!yyjson_is_arr(models) || !yyjson_arr_size(models)
                || yyjson_arr_size(models)>32))
            || yyjson_obj_size(entry)!=(size_t)(1+(key?1:0)+(models?1:0))
            || !strcmp(yyjson_get_str(url),cfg->upstream)) {
            ok=0;break;
        }
        for(size_t j=0;j<cfg->pool_count;j++)
            if(!strcmp(yyjson_get_str(url),cfg->pool[j].url))ok=0;
        if(!ok)break;
        if(models)for(size_t j=0;j<yyjson_arr_size(models);j++) {
            yyjson_val *item=yyjson_arr_get(models,j);
            if(!yyjson_is_str(item) || !yyjson_get_len(item)
                || yyjson_get_len(item)>255
                || strlen(yyjson_get_str(item))!=yyjson_get_len(item)) {
                ok=0;break;
            }
            const unsigned char *name=(const unsigned char *)yyjson_get_str(item);
            for(size_t k=0;k<yyjson_get_len(item);k++)
                if(name[k]<32 || name[k]==127)ok=0;
            for(size_t k=0;k<j;k++)
                if(!strcmp((const char *)name,
                           yyjson_get_str(yyjson_arr_get(models,k))))ok=0;
            if(!ok)break;
        }
        if(!ok)break;
        const char *secret="";
        if(key) {
            const char *name=yyjson_get_str(key);
            if(!((*name>='A'&&*name<='Z') ||
                (*name>='a'&&*name<='z') || *name=='_')){ok=0;break;}
            for(const char *p=name+1;*p;p++)
                if(!((*p>='A'&&*p<='Z') || (*p>='a'&&*p<='z')
                    || (*p>='0'&&*p<='9') || *p=='_'))ok=0;
            if(!ok)break;
            secret=getenv(name);
            if(!secret || strpbrk(secret,"\r\n")){ok=0;break;}
        }
        yag_pool_backend *backend=&cfg->pool[cfg->pool_count];
        backend->url=strdup(yyjson_get_str(url));
        backend->key=secret;
        backend->enabled=1;
        backend->priority=50;
        if(key)backend->key_env=strdup(yyjson_get_str(key));
        if(!backend->url || (key && !backend->key_env)){ok=0;break;}
        cfg->pool_count++;
        if(models)for(size_t j=0;j<yyjson_arr_size(models);j++) {
            backend->models[j]=strdup(yyjson_get_str(yyjson_arr_get(models,j)));
            if(!backend->models[j]){ok=0;break;}
            backend->model_count++;
        }
        if(!ok)break;
    }
    yyjson_doc_free(doc);
    if(!ok)fprintf(stderr,
        "YAG_UPSTREAM_POOL: expected up to 8 distinct URL replicas, optional key_env and optional nonempty models array (max 32)\n");
    return ok?0:-1;
}
static int load_routes(yag_config *c) {
    const char *raw=getenv("YAG_MODEL_ROUTES");
    if(!raw || !*raw)return 0;
    yyjson_doc *doc=yyjson_read(raw,strlen(raw),0);
    yyjson_val *list=doc?yyjson_doc_get_root(doc):NULL;
    int ok=yyjson_is_arr(list) && yyjson_arr_size(list)<=16;
    if(ok) for(size_t i=0;i<yyjson_arr_size(list);i++) {
        yyjson_val *route=yyjson_arr_get(list,i);
        yyjson_val *m=yyjson_obj_get(route,"model"),*u=yyjson_obj_get(route,"url"),*k=yyjson_obj_get(route,"key_env");
        if(!yyjson_is_obj(route) || !yyjson_is_str(m) || !yyjson_is_str(u)
            || !yyjson_get_len(m) || !yyjson_get_len(u)
            || strlen(yyjson_get_str(m))!=yyjson_get_len(m)
            || strlen(yyjson_get_str(u))!=yyjson_get_len(u)
            || !valid_url(yyjson_get_str(u))
            || (k && (!yyjson_is_str(k) || !yyjson_get_len(k)
                || strlen(yyjson_get_str(k))!=yyjson_get_len(k)))
            || yyjson_obj_size(route)!=(size_t)(k?3:2)) {ok=0;break;}
        for(size_t j=0;j<c->route_count;j++)
            if(!strcmp(c->routes[j].model,yyjson_get_str(m)))ok=0;
        if(!ok)break;
        const char *secret="";
        if(k) {
            const char *name=yyjson_get_str(k);
            if(!((*name>='A'&&*name<='Z')||(*name>='a'&&*name<='z')||*name=='_')){ok=0;break;}
            for(const char *p=name+1;*p;p++)
                if(!((*p>='A'&&*p<='Z')||(*p>='a'&&*p<='z')||(*p>='0'&&*p<='9')||*p=='_'))ok=0;
            if(!ok)break;
            secret=getenv(name);
            if(!secret || strpbrk(secret,"\r\n")){ok=0;break;}
        }
        yag_route *r=&c->routes[c->route_count];
        r->model=strdup(yyjson_get_str(m));
        r->url=strdup(yyjson_get_str(u));
        r->key=secret;
        if(!r->model || !r->url){ok=0;break;}
        c->route_count++;
    }
    yyjson_doc_free(doc);
    if(!ok)fprintf(stderr,"YAG_MODEL_ROUTES must be an array of up to 16 unique model/url objects with optional valid key_env\n");
    return ok?0:-1;
}
static const char *const feature_names[]={
    "streaming","function_tools","json_schema","reasoning","vision","audio",NULL
};
static int load_capabilities(yag_config *cfg) {
    const char *raw=getenv("YAG_MODEL_CAPABILITIES");
    if(!raw || !*raw)return 0;
    yyjson_doc *doc=yyjson_read(raw,strlen(raw),0);
    yyjson_val *root=doc?yyjson_doc_get_root(doc):NULL;
    int valid=yyjson_is_arr(root) && yyjson_arr_size(root)<=32;
    if(valid)for(size_t i=0;i<yyjson_arr_size(root);i++) {
        yyjson_val *item=yyjson_arr_get(root,i);
        yyjson_val *model=yyjson_obj_get(item,"model");
        yyjson_val *features=yyjson_obj_get(item,"features");
        yyjson_val *window=yyjson_obj_get(item,"context_window");
        if(!yyjson_is_obj(item) || !yyjson_is_str(model)
            || !yyjson_get_len(model) || yyjson_get_len(model)>128
            || strlen(yyjson_get_str(model))!=yyjson_get_len(model)
            || !yyjson_is_arr(features) || yyjson_arr_size(features)>6
            || yyjson_obj_size(item)!=(size_t)(window?3:2)
            || (window && (!yyjson_is_uint(window)
                || yyjson_get_uint(window)<1024 || yyjson_get_uint(window)>2097152))) {
            valid=0;break;
        }
        for(size_t j=0;j<cfg->capability_count;j++)
            if(!strcmp(cfg->capabilities[j].model,yyjson_get_str(model)))valid=0;
        if(!valid)break;
        unsigned mask=0;
        size_t j,n;yyjson_val *feature;
        yyjson_arr_foreach(features,j,n,feature) {
            int found=0;
            for(unsigned k=0;feature_names[k];k++)
                if(yyjson_equals_str(feature,feature_names[k])) {
                    if(mask&(1u<<k)){valid=0;break;}
                    mask|=1u<<k;found=1;break;
                }
            if(!found || !valid){valid=0;break;}
        }
        if(!valid)break;
        yag_model_capability *entry=&cfg->capabilities[cfg->capability_count];
        entry->model=strdup(yyjson_get_str(model));
        if(!entry->model){valid=0;break;}
        entry->feature_mask=mask;
        entry->has_context_window=window!=NULL;
        if(window)entry->context_window=(unsigned)yyjson_get_uint(window);
        cfg->capability_count++;
    }
    yyjson_doc_free(doc);
    if(!valid)fprintf(stderr,
        "YAG_MODEL_CAPABILITIES must be an array of <=32 unique model entries "
        "with allowlisted features and an optional context_window\n");
    return valid?0:-1;
}
const yag_config *config_for_model(const yag_config *c,const char *model,yag_config *selected) {
    if(model)for(size_t i=0;i<c->route_count;i++) {
        if(strcmp(model,c->routes[i].model))continue;
        memset(selected,0,sizeof *selected);
        selected->upstream=c->routes[i].url;
        selected->upstream_key=c->routes[i].key;
        selected->timeout=c->timeout;
        return selected;
    }
    return c;
}

/* Explicit opt-in and fail-closed file setup: no symlinks, other-user
 * read/write access, hardlinks, special files or relative paths. */
static int open_admin_audit(yag_config *cfg) {
    const char *path=getenv("YAG_ADMIN_AUDIT_FILE");
    if(!path || !*path)return 0;
    if(path[0]!='/' || strlen(path)>1024 || strchr(path,13) || strchr(path,10)) {
        fputs("YAG_ADMIN_AUDIT_FILE must be an absolute private path",stderr);
        return -1;
    }
    int fd=open(path,O_WRONLY|O_APPEND|O_CREAT|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK,0600);
    struct stat st;
    if(fd<0 || fstat(fd,&st) ||
        !S_ISREG(st.st_mode) || (st.st_mode & 0077) ||
        st.st_uid!=geteuid() || st.st_nlink!=1) {
        if(fd>=0)close(fd);
        fputs("Cannot open YAG_ADMIN_AUDIT_FILE as a private regular file",stderr);
        return -1;
    }
    cfg->admin_audit_fd=fd;
    return 0;
}
int config_load(yag_config *c) {
    memset(c, 0, sizeof(*c));
    c->admin_audit_fd=-1;
    c->bind=env("YAG_BIND", "127.0.0.1"); c->port=env("YAG_PORT", "8080");
    c->upstream=env("YAG_UPSTREAM_URL", "http://127.0.0.1:8000/v1");
    c->upstream_key=env("YAG_UPSTREAM_KEY", ""); c->api_key=env("YAG_API_KEY", "");
    c->assets=env("YAG_ASSETS", "console/dist"); c->timeout=120; c->started=time(NULL);
    const char *t=env("YAG_TIMEOUT", "120"); char *end=NULL; c->timeout=strtol(t,&end,10);
    if (*end || c->timeout < 1 || c->timeout > 3600) { fprintf(stderr,"YAG_TIMEOUT must be 1..3600 seconds\n"); return -1; }
    if (strlen(c->api_key)<16 || strpbrk(c->api_key,"\r\n") || strpbrk(c->upstream_key,"\r\n")) { fprintf(stderr,"YAG_API_KEY is required (at least 16 characters); keys must not contain newlines\n"); return -1; }
    if ((strncmp(c->upstream,"http://",7) && strncmp(c->upstream,"https://",8)) || strpbrk(c->upstream,"\r\n?#") || c->upstream[strlen(c->upstream)-1]=='/') { fprintf(stderr,"YAG_UPSTREAM_URL must be an HTTP(S) base URL without a trailing slash, query, or fragment\n"); return -1; }
    const char *extra=env("YAG_EXTRA_API_KEYS", "");
    if (*extra) {
        c->extra_keys_storage=strdup(extra);
        if (!c->extra_keys_storage) return -1;
        char *start=c->extra_keys_storage;
        for (;;) {
            char *comma=strchr(start, ',');
            if (comma) *comma=0;
            if (!*start || strlen(start)<16 || strpbrk(start,"\r\n") || c->extra_key_count>=16) {
                fprintf(stderr,"YAG_EXTRA_API_KEYS requires 1..16 comma-separated keys of at least 16 characters, without empty entries or newlines\n");
                return -1;
            }
            /* Authentication selects the last matching extra-key index.
             * Duplicate secrets with different scopes could silently change
             * the effective privilege level. Reject ambiguous key mappings. */
            if(!strcmp(start,c->api_key)) {
                fprintf(stderr,"YAG_EXTRA_API_KEYS must not duplicate the primary key\n");
                return -1;
            }
            for(size_t i=0;i<c->extra_key_count;i++) {
                if(!strcmp(start,c->extra_keys[i])) {
                    fprintf(stderr,"YAG_EXTRA_API_KEYS must contain unique keys\n");
                    return -1;
                }
            }
            c->extra_keys[c->extra_key_count++]=start;
            if (!comma) break;
            start=comma+1;
        }
    }
    /* All extra keys default to legacy full access. Scope restrictions are
     * opt-in, aligned positionally with YAG_EXTRA_API_KEYS. No key is logged. */
    for(size_t i=0;i<c->extra_key_count;i++)c->extra_key_scopes[i]=15;
    const char *policies=env("YAG_EXTRA_KEY_SCOPES","");
    if(*policies) {
        if(!c->extra_key_count){fprintf(stderr,"YAG_EXTRA_KEY_SCOPES requires extra keys\n");return -1;}
        c->extra_scope_storage=strdup(policies);
        if(!c->extra_scope_storage)return -1;
        size_t position=0;
        char *start=c->extra_scope_storage;
        for(;;) {
            char *comma=strchr(start,',');
            if(comma)*comma=0;
            if(position>=c->extra_key_count) {
                fprintf(stderr,"YAG_EXTRA_KEY_SCOPES count mismatch\n");return -1;
            }
            unsigned scope=0;
            if(!strcmp(start,"all"))scope=15;
            else if(!strcmp(start,"inference"))scope=1;
            else if(!strcmp(start,"models"))scope=2;
            else if(!strcmp(start,"monitor"))scope=4;
            else if(!strcmp(start,"inference+models"))scope=3;
            else {
                fprintf(stderr,"Invalid YAG_EXTRA_KEY_SCOPES entry\n");return -1;
            }
            c->extra_key_scopes[position++]=scope;
            if(!comma)break;
            start=comma+1;
        }
        if(position!=c->extra_key_count) {
            fprintf(stderr,"YAG_EXTRA_KEY_SCOPES count mismatch\n");return -1;
        }
    }
    const char *rate=env("YAG_RATE_LIMIT_PER_MINUTE","0");
    char *rate_end=NULL;
    errno=0;
    unsigned long parsed_rate=strtoul(rate,&rate_end,10);
    if(errno || *rate_end || rate_end==rate || parsed_rate>60000) {
        fprintf(stderr,"YAG_RATE_LIMIT_PER_MINUTE must be an integer from 0 to 60000\n");
        return -1;
    }
    c->rate_limit_per_minute=(unsigned)parsed_rate;
    const char *fallback=env("YAG_FALLBACK_TO_DEFAULT","0");
    if(strcmp(fallback,"0") && strcmp(fallback,"1")) {
        fprintf(stderr,"YAG_FALLBACK_TO_DEFAULT must be 0 or 1\n");
        return -1;
    }
    c->fallback_to_default=!strcmp(fallback,"1");
    const char *threshold=env("YAG_CIRCUIT_THRESHOLD","0");
    const char *cooldown=env("YAG_CIRCUIT_COOLDOWN_SECONDS","30");
    char *threshold_end=NULL,*cooldown_end=NULL;
    errno=0;
    unsigned long threshold_value=strtoul(threshold,&threshold_end,10);
    int invalid=errno || threshold_end==threshold || *threshold_end || threshold_value>20;
    errno=0;
    unsigned long cooldown_value=strtoul(cooldown,&cooldown_end,10);
    invalid|=errno || cooldown_end==cooldown || *cooldown_end
        || cooldown_value<1 || cooldown_value>3600;
    if(invalid) {
        fprintf(stderr,"YAG_CIRCUIT_THRESHOLD must be 0..20; "
            "YAG_CIRCUIT_COOLDOWN_SECONDS must be 1..3600\\n");
        return -1;
    }
    c->circuit_threshold=(unsigned)threshold_value;
    c->circuit_cooldown_seconds=(unsigned)cooldown_value;
    const char *header_deadline=env("YAG_HEADER_DEADLINE_SECONDS","10");
    const char *body_deadline=env("YAG_BODY_DEADLINE_SECONDS","30");
    char *he=NULL,*be=NULL;
    errno=0;unsigned long hv=strtoul(header_deadline,&he,10);
    int bad=errno || he==header_deadline || *he || hv<1 || hv>300;
    errno=0;unsigned long bv=strtoul(body_deadline,&be,10);
    bad|=errno || be==body_deadline || *be || bv<1 || bv>3600;
    if(bad) {
        fprintf(stderr,"YAG_HEADER_DEADLINE_SECONDS must be 1..300; "
            "YAG_BODY_DEADLINE_SECONDS must be 1..3600\n");
        return -1;
    }
    c->header_deadline_seconds=(unsigned)hv;
    c->body_deadline_seconds=(unsigned)bv;
    if(env_limit("YAG_MAX_BODY_BYTES","1048576",8388608,&c->max_body_bytes)
        || c->max_body_bytes<65536) {
        fprintf(stderr,"YAG_MAX_BODY_BYTES must be 65536..8388608\n");
        return -1;
    }
    const char *enforce=env("YAG_ENFORCE_MODEL_CAPABILITIES","0");
    if(strcmp(enforce,"0") && strcmp(enforce,"1")) {
        fprintf(stderr,"YAG_ENFORCE_MODEL_CAPABILITIES must be 0 or 1\n");
        return -1;
    }
    c->enforce_model_capabilities=!strcmp(enforce,"1");
    if(env_limit("YAG_MAX_INFERENCE","0",32,&c->max_inference)
        || env_limit("YAG_MAX_INFERENCE_PER_KEY","0",32,&c->max_per_key)
        || env_limit("YAG_INFERENCE_QUEUE_WAIT_MS","0",60000,&c->queue_wait_ms))
        return -1;
    c->client_store=env("YAG_CLIENT_STORE","");
    c->provider_store=env("YAG_PROVIDER_STORE","");
    c->ollama_admin_url=env("YAG_OLLAMA_ADMIN_URL","");
    if(*c->ollama_admin_url && !valid_url(c->ollama_admin_url)) {
        fprintf(stderr,"YAG_OLLAMA_ADMIN_URL must be a valid HTTP(S) base URL\n");
        return -1;
    }
    c->static_key_count=c->extra_key_count;
    for(size_t i=0;i<c->static_key_count;i++)c->key_enabled[i]=1;

    if (load_routes(c) || load_pool(c) || provider_manager_load(c)
        || load_capabilities(c) || open_admin_audit(c)) return -1;
    if (strcmp(c->bind,"127.0.0.1") && strcmp(c->bind,"::1")) fprintf(stderr,"WARNING: LAN exposure enabled. HTTP is unencrypted; use a trusted TLS reverse proxy and firewall.\n");
    if(pthread_mutex_init(&c->lock,NULL))return -1;
    if(pthread_cond_init(&c->drained,NULL)) {
        pthread_mutex_destroy(&c->lock);return -1;
    }
    if(pthread_cond_init(&c->inference_available,NULL)) {
        pthread_cond_destroy(&c->drained);
        pthread_mutex_destroy(&c->lock);return -1;
    }
    if(pthread_cond_init(&c->ollama_job_done,NULL)) {
        pthread_cond_destroy(&c->inference_available);
        pthread_cond_destroy(&c->drained);
        pthread_mutex_destroy(&c->lock);return -1;
    }
    if(client_registry_load(c)) {
        pthread_cond_destroy(&c->ollama_job_done);
        pthread_cond_destroy(&c->inference_available);
        pthread_cond_destroy(&c->drained);
        pthread_mutex_destroy(&c->lock);return -1;
    }
    return 0;
}

void config_free(yag_config *c) {
    pthread_mutex_lock(&c->lock);
    c->ollama_job_shutdown=1;
    while(c->ollama_job_running)
        pthread_cond_wait(&c->ollama_job_done,&c->lock);
    pthread_mutex_unlock(&c->lock);
    client_registry_free(c);
    pthread_cond_destroy(&c->ollama_job_done);
    pthread_cond_destroy(&c->inference_available);
    pthread_cond_destroy(&c->drained);
    pthread_mutex_destroy(&c->lock);
    for(size_t i=0;i<c->route_count;i++) {
        free(c->routes[i].model);free(c->routes[i].url);
    }
    provider_pool_free(c->pool,c->pool_count);
    free(c->extra_keys_storage);
    free(c->extra_scope_storage);
    for(size_t i=0;i<c->capability_count;i++)free(c->capabilities[i].model);
    if(c->admin_audit_fd>=0)close(c->admin_audit_fd);
}
