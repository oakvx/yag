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
    if (load_routes(c)) return -1;
    if (strcmp(c->bind,"127.0.0.1") && strcmp(c->bind,"::1")) fprintf(stderr,"WARNING: LAN exposure enabled. HTTP is unencrypted; use a trusted TLS reverse proxy and firewall.\n");
    return pthread_mutex_init(&c->lock,NULL);
}
