#include "yag.h"
#include "yyjson.h"
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <string.h>
static const char *env(const char *key, const char *fallback) { const char *v=getenv(key); return v && *v ? v : fallback; }

static int valid_url(const char *url) {
    size_t n=strlen(url);
    return n && (!strncmp(url,"http://",7) || !strncmp(url,"https://",8))
        && !strpbrk(url,"\r\n?#") && url[n-1]!='/';
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
        yyjson_val *cap=yyjson_obj_get(route,"capabilities");
        const char *const caps_allowed[]={"tools","streaming","vision","reasoning","max_context_tokens",NULL};
        if(cap) {
            if(!yyjson_is_obj(cap) || !yyjson_obj_size(cap)){ok=0;break;}
            yyjson_obj_iter iterator=yyjson_obj_iter_with(cap);
            yyjson_val *field;
            while((field=yyjson_obj_iter_next(&iterator))) {
                int recognized=0;
                for(size_t t=0;caps_allowed[t];t++)
                    if(yyjson_equals_str(field,caps_allowed[t])){recognized=1;break;}
                if(!recognized){ok=0;break;}
                yyjson_val *value=yyjson_obj_iter_get_val(field);
                if(yyjson_equals_str(field,"max_context_tokens")) {
                    if(!yyjson_is_uint(value) || !yyjson_get_uint(value)
                        || yyjson_get_uint(value)>100000000){ok=0;break;}
                } else if(!yyjson_is_bool(value)){ok=0;break;}
            }
            if(!ok)break;
        }
        if(!yyjson_is_obj(route) || !yyjson_is_str(m) || !yyjson_is_str(u)
            || !yyjson_get_len(m) || !yyjson_get_len(u)
            || strlen(yyjson_get_str(m))!=yyjson_get_len(m)
            || strlen(yyjson_get_str(u))!=yyjson_get_len(u)
            || !valid_url(yyjson_get_str(u))
            || (k && (!yyjson_is_str(k) || !yyjson_get_len(k)
                || strlen(yyjson_get_str(k))!=yyjson_get_len(k)))
            || yyjson_obj_size(route)!=(size_t)(2+(k?1:0)+(cap?1:0))) {ok=0;break;}
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
        if(cap) {
            r->capabilities_declared=1;
            yyjson_val *v;
            v=yyjson_obj_get(cap,"tools");r->tools=v?yyjson_get_bool(v):-1;
            v=yyjson_obj_get(cap,"streaming");r->streaming=v?yyjson_get_bool(v):-1;
            v=yyjson_obj_get(cap,"vision");r->vision=v?yyjson_get_bool(v):-1;
            v=yyjson_obj_get(cap,"reasoning");r->reasoning=v?yyjson_get_bool(v):-1;
            v=yyjson_obj_get(cap,"max_context_tokens");
            r->max_context_tokens=v?(unsigned)yyjson_get_uint(v):0;
        } else r->tools=r->streaming=r->vision=r->reasoning=-1;
        if(!r->model || !r->url){ok=0;break;}
        c->route_count++;
    }
    yyjson_doc_free(doc);
    if(!ok)fprintf(stderr,"YAG_MODEL_ROUTES must be an array of up to 16 unique model/url objects with optional valid key_env and capabilities\n");
    return ok?0:-1;
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

int config_load(yag_config *c) {
    memset(c, 0, sizeof(*c));
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
            c->extra_keys[c->extra_key_count++]=start;
            if (!comma) break;
            start=comma+1;
        }
    }
    const char *scope_list=getenv("YAG_EXTRA_KEY_SCOPES");
    if(scope_list && *scope_list) {
        if(!c->extra_key_count) {
            fprintf(stderr,"YAG_EXTRA_KEY_SCOPES requires YAG_EXTRA_API_KEYS\n");return -1;
        }
        c->extra_scopes_storage=strdup(scope_list);
        if(!c->extra_scopes_storage)return -1;
        char *start=c->extra_scopes_storage;
        for(size_t i=0;i<c->extra_key_count;i++) {
            char *comma=strchr(start,',');
            if(comma)*comma=0;
            if(!strcmp(start,"inference"))c->extra_inference_only[i]=1;
            else if(strcmp(start,"all")) {
                fprintf(stderr,"YAG_EXTRA_KEY_SCOPES expects all or inference per extra key\n");
                return -1;
            }
            if(i+1<c->extra_key_count) {
                if(!comma){fprintf(stderr,"Not enough YAG_EXTRA_KEY_SCOPES entries\n");return -1;}
                start=comma+1;
            } else if(comma) {
                fprintf(stderr,"Too many YAG_EXTRA_KEY_SCOPES entries\n");return -1;
            }
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
    const char *threshold=env("YAG_CIRCUIT_FAILURE_THRESHOLD","0");
    const char *cooldown=env("YAG_CIRCUIT_COOLDOWN_SECONDS","30");
    char *end_threshold=NULL,*end_cooldown=NULL;
    errno=0;
    unsigned long th=strtoul(threshold,&end_threshold,10);
    if(errno || !*threshold || *end_threshold || th>100) {
        fprintf(stderr,"YAG_CIRCUIT_FAILURE_THRESHOLD must be 0..100\n");return -1;
    }
    errno=0;
    unsigned long cool=strtoul(cooldown,&end_cooldown,10);
    if(errno || !*cooldown || *end_cooldown || cool<1 || cool>3600) {
        fprintf(stderr,"YAG_CIRCUIT_COOLDOWN_SECONDS must be 1..3600\n");return -1;
    }
    c->circuit_failure_threshold=(unsigned)th;
    c->circuit_cooldown_seconds=(unsigned)cool;
    if (load_routes(c)) return -1;
    if (strcmp(c->bind,"127.0.0.1") && strcmp(c->bind,"::1")) fprintf(stderr,"WARNING: LAN exposure enabled. HTTP is unencrypted; use a trusted TLS reverse proxy and firewall.\n");
    if(pthread_mutex_init(&c->lock,NULL))return -1;
    if(pthread_cond_init(&c->drained,NULL)) {
        pthread_mutex_destroy(&c->lock);return -1;
    }
    return 0;
}

void config_free(yag_config *c) {
    pthread_cond_destroy(&c->drained);
    pthread_mutex_destroy(&c->lock);
    for(size_t i=0;i<c->route_count;i++) {
        free(c->routes[i].model);free(c->routes[i].url);
    }
    free(c->extra_keys_storage);
    free(c->extra_scopes_storage);
}
