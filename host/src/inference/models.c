#include "yag.h"
#include "yyjson.h"
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MODEL_LIST_LIMIT (1024*1024)
typedef struct { char *bytes; size_t size; } listing;

static size_t collect(void *ctx,long status,const char *type,const char *data,size_t len) {
    (void)status;(void)type;
    listing *buf=ctx;
    if(len>MODEL_LIST_LIMIT || buf->size>MODEL_LIST_LIMIT-len)return 0;
    char *next=realloc(buf->bytes,buf->size+len+1);
    if(!next)return 0;
    buf->bytes=next;
    memcpy(buf->bytes+buf->size,data,len);
    buf->size+=len;
    buf->bytes[buf->size]=0;
    return len;
}
static void fail(int fd,int status,const char *reason) {
    char body[256];
    snprintf(body,sizeof body,"{\"error\":{\"message\":\"%s\",\"type\":\"upstream_error\"}}",reason);
    reply(fd,status,"application/json",body);
}
/* Caller holds cfg->lock. A dedicated ID has precedence over the default
 * provider catalog even if that provider advertises the same string. */
static int reserved_model_locked(const yag_config *cfg,const char *id) {
    for(size_t p=0;p<cfg->pool_count;p++) {
        const yag_pool_backend *backend=&cfg->pool[p];
        if(!backend->exclusive_models)continue;
        for(size_t m=0;m<backend->model_count;m++)
            if(!strcmp(backend->models[m],id))return 1;
    }
    return 0;
}
/* Security metadata belongs to YAG, never to the model provider.
 * A loopback upstream is only a transport property: a proxy on loopback
 * could still call an external service. This is NOT a billing guarantee. */
static int endpoint_loopback(const char *raw) {
    if(!raw || !*raw)return 0;
    CURLU *url=curl_url();
    if(!url)return 0;
    char *host=NULL,*scheme=NULL;
    int safe=curl_url_set(url,CURLUPART_URL,raw,0)==CURLUE_OK
        && curl_url_get(url,CURLUPART_HOST,&host,0)==CURLUE_OK
        && curl_url_get(url,CURLUPART_SCHEME,&scheme,0)==CURLUE_OK
        && (!strcmp(scheme,"http") || !strcmp(scheme,"https"))
        && (!strcmp(host,"localhost") || !strcmp(host,"127.0.0.1")
            || !strcmp(host,"[::1]") || !strcmp(host,"::1"));
    curl_free(host);curl_free(scheme);curl_url_cleanup(url);
    return safe;
}

static int model_may_use_url(const yag_pool_backend *backend,const char *id) {
    if(!backend->enabled)return 0;
    if(!backend->model_count)return 1;
    for(size_t i=0;i<backend->model_count;i++)
        if(!strcmp(backend->models[i],id))return 1;
    return 0;
}

/* Caller holds cfg->lock. Fail conservatively whenever any eligible route
 * could take a model beyond the default loopback backend. */
static void model_transport_locked(const yag_config *cfg,const char *id,
                                   int *loopback_only,int *remote_https) {
    *loopback_only=endpoint_loopback(cfg->upstream);
    *remote_https=cfg->upstream && !strncmp(cfg->upstream,"https://",8);
    for(size_t r=0;r<cfg->route_count;r++)if(!strcmp(cfg->routes[r].model,id)) {
        if(!endpoint_loopback(cfg->routes[r].url))*loopback_only=0;
        if(!strncmp(cfg->routes[r].url,"https://",8))*remote_https=1;
    }
    for(size_t p=0;p<cfg->pool_count;p++) {
        const yag_pool_backend *backend=&cfg->pool[p];
        if(!model_may_use_url(backend,id))continue;
        if(!endpoint_loopback(backend->url))*loopback_only=0;
        if(!strncmp(backend->url,"https://",8))*remote_https=1;
    }
}

static void models_respond(int fd,const yag_config *cfg,const char *model_id) {
    listing response={0};
    long status=0;
    int rc=upstream_perform(cfg,"/models",NULL,0,collect,&response,&status,fd);
    int default_available=rc==CURLE_OK && status>=200 && status<300;
    int has_dedicated=0;
    pthread_mutex_lock((pthread_mutex_t *)&cfg->lock);
    for(size_t p=0;p<cfg->pool_count;p++)
        if(cfg->pool[p].enabled && cfg->pool[p].exclusive_models
            && cfg->pool[p].model_count)has_dedicated=1;
    pthread_mutex_unlock((pthread_mutex_t *)&cfg->lock);
    if(!default_available && !has_dedicated) {
        int code=rc==CURLE_OPERATION_TIMEDOUT?504:status==429?429:502;
        fail(fd,code,"Default model provider unavailable or returned an error");
        free(response.bytes);return;
    }
    yyjson_doc *upstream=default_available?
        yyjson_read(response.bytes,response.size,0):NULL;
    yyjson_val *root=upstream?yyjson_doc_get_root(upstream):NULL;
    yyjson_val *models=yyjson_obj_get(root,"data");
    if(default_available && (!yyjson_is_obj(root) || !yyjson_is_arr(models))) {
        fail(fd,502,"Default model provider returned an invalid model list");
        yyjson_doc_free(upstream);free(response.bytes);return;
    }
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);
    if(!d){fail(fd,500,"Out of memory");yyjson_doc_free(upstream);free(response.bytes);return;}
    yyjson_mut_val *output=yyjson_mut_obj(d),*items=yyjson_mut_arr(d);
    int good=output && items && yyjson_mut_obj_add_str(d,output,"object","list")
        && yyjson_mut_obj_add_val(d,output,"data",items);
    size_t i,count;yyjson_val *item;
    if(good && default_available) {
        pthread_mutex_lock((pthread_mutex_t *)&cfg->lock);
        yyjson_arr_foreach(models,i,count,item) {
            yyjson_val *id=yyjson_obj_get(item,"id");
            if(!yyjson_is_obj(item) || !yyjson_is_str(id)
                || !yyjson_get_len(id) || strlen(yyjson_get_str(id))!=yyjson_get_len(id)) {
                good=0;break;
            }
            if(reserved_model_locked(cfg,yyjson_get_str(id)))continue;
            /* Never copy provider-defined yag_* booleans: upstream services
             * must not be able to counterfeit trusted egress classifications. */
            const char *name=yyjson_get_str(id);
            yyjson_val *owner=yyjson_obj_get(item,"owned_by");
            yyjson_val *created=yyjson_obj_get(item,"created");
            int loopback=0,https=0;
            model_transport_locked(cfg,name,&loopback,&https);
            yyjson_mut_val *entry=yyjson_mut_obj(d);
            if(!entry || !yyjson_mut_obj_add_strcpy(d,entry,"id",name)
                || !yyjson_mut_obj_add_str(d,entry,"object","model")
                || !yyjson_mut_obj_add_strcpy(d,entry,"owned_by",
                    yyjson_is_str(owner)?yyjson_get_str(owner):"yag-default-upstream")
                || !yyjson_mut_obj_add_bool(d,entry,"yag_loopback_only",loopback)
                || !yyjson_mut_obj_add_bool(d,entry,"yag_remote_https",https)
                || !yyjson_mut_obj_add_bool(d,entry,"yag_dedicated",0)
                || (yyjson_is_uint(created) &&
                    !yyjson_mut_obj_add_uint(d,entry,"created",yyjson_get_uint(created)))
                || !yyjson_mut_arr_add_val(items,entry)) {
                good=0;break;
            }
        }
        pthread_mutex_unlock((pthread_mutex_t *)&cfg->lock);
    }
    if(good)for(size_t r=0;r<cfg->route_count;r++) {
        int exists=0;
        if(default_available)yyjson_arr_foreach(models,i,count,item) {
            yyjson_val *id=yyjson_obj_get(item,"id");
            if(yyjson_is_str(id) && yyjson_equals_str(id,cfg->routes[r].model)) {
                exists=1;break;
            }
        }
        if(exists)continue;
        yyjson_mut_val *entry=yyjson_mut_obj(d);
        if(!entry || !yyjson_mut_obj_add_str(d,entry,"object","model")
            || !yyjson_mut_obj_add_strcpy(d,entry,"id",cfg->routes[r].model)
            || !yyjson_mut_obj_add_str(d,entry,"owned_by","yag-configured-route")
            || !yyjson_mut_obj_add_bool(d,entry,"yag_remote_https",
                !strncmp(cfg->routes[r].url,"https://",8))
            || !yyjson_mut_obj_add_bool(d,entry,"yag_loopback_only",
                endpoint_loopback(cfg->routes[r].url))
            || !yyjson_mut_arr_add_val(items,entry)){good=0;break;}
    }
    /* Publish enabled managed-provider model IDs without probing remote APIs
     * or trusting provider-advertised capabilities. Deduplicate against the
     * default inventory and exact routes; disabled providers stay hidden. */
    pthread_mutex_lock((pthread_mutex_t *)&cfg->lock);
    if(good)for(size_t p=0;p<cfg->pool_count;p++) {
        const yag_pool_backend *backend=&cfg->pool[p];
        if(!backend->enabled || !backend->exclusive_models)continue;
        for(size_t m=0;good && m<backend->model_count;m++) {
            const char *name=backend->models[m];
            int exists=0;
            yyjson_mut_val *known;
            yyjson_mut_arr_foreach(items,i,count,known) {
                if(yyjson_mut_equals_str(yyjson_mut_obj_get(known,"id"),name)) {
                    exists=1;break;
                }
            }
            if(exists)continue;
            yyjson_mut_val *entry=yyjson_mut_obj(d);
            if(!entry || !yyjson_mut_obj_add_str(d,entry,"object","model")
                || !yyjson_mut_obj_add_strcpy(d,entry,"id",name)
                || !yyjson_mut_obj_add_str(d,entry,"owned_by","yag-managed-provider")
                || !yyjson_mut_obj_add_bool(d,entry,"yag_dedicated",1)
                || !yyjson_mut_obj_add_bool(d,entry,"yag_remote_https",
                    !strncmp(backend->url,"https://",8))
                || !yyjson_mut_obj_add_bool(d,entry,"yag_loopback_only",
                    endpoint_loopback(backend->url))
                || !yyjson_mut_arr_add_val(items,entry)){good=0;break;}
        }
    }
    pthread_mutex_unlock((pthread_mutex_t *)&cfg->lock);
    char *json=NULL;
    int missing=0;
    if(good) {
        if(model_id) {
            /* Resolve from the merged inventory, so configured route IDs and
             * default-upstream models behave identically for SDK retrieval. */
            yyjson_mut_val *entry,*match=NULL;
            yyjson_mut_arr_foreach(items,i,count,entry) {
                if(yyjson_mut_equals_str(yyjson_mut_obj_get(entry,"id"),model_id)) {
                    match=entry;break;
                }
            }
            if(match) {
                if(!yyjson_mut_obj_get(match,"object"))
                    good=yyjson_mut_obj_add_str(d,match,"object","model");
                if(good)yyjson_mut_doc_set_root(d,match);
            } else missing=1;
        } else yyjson_mut_doc_set_root(d,output);
        if(good && !missing)json=yyjson_mut_write(d,0,NULL);
    }
    if(missing)reply(fd,404,"application/json",
        "{\"error\":{\"message\":\"Model not found\",\"type\":\"not_found_error\"}}");
    else if(json)reply(fd,200,"application/json",json);
    else fail(fd,502,"Model inventory could not be translated");
    free(json);yyjson_mut_doc_free(d);yyjson_doc_free(upstream);free(response.bytes);
}
void models_handle(int fd,const yag_config *cfg) {
    models_respond(fd,cfg,NULL);
}
void models_handle_detail(int fd,const yag_config *cfg,const char *model_id) {
    models_respond(fd,cfg,model_id);
}
