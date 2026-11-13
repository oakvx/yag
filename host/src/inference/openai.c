#include "yag.h"
#include "yyjson.h"
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <poll.h>
#include <sys/socket.h>
#include <errno.h>

typedef struct { int fd, sent; long status; char content_type[128]; yag_upstream_write callback; void *context; } transfer;
static void start(transfer *t) {
    if(t->sent) return;
    char h[512]; long s=t->status ? t->status : 502;
    int n=snprintf(h,sizeof h,"HTTP/1.1 %ld %s\r\nContent-Type: %s\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",s, s<400?"OK":"Upstream Error",t->content_type[0]?t->content_type:"application/json");
    if(n>0 && (size_t)n<sizeof h) send_all(t->fd,h,(size_t)n);
    t->sent=1;
}
static size_t headers(char *ptr, size_t size, size_t nmemb, void *arg) {
    size_t n=size*nmemb; transfer *t=arg;
    if (n>=5 && !memcmp(ptr,"HTTP/",5)) { long s=0; const char *space=memchr(ptr,' ',n); if(space) s=strtol(space+1,NULL,10); t->status=s; t->content_type[0]=0; }
    else if(n>14 && !strncasecmp(ptr,"Content-Type:",13)) {
        size_t i=13; while(i<n && (ptr[i]==' '||ptr[i]=='\t')) i++; size_t j=0;
        while(i<n && ptr[i]!='\r' && ptr[i]!='\n' && j<sizeof(t->content_type)-1) t->content_type[j++]=ptr[i++];
        t->content_type[j]=0;
    }
    return n;
}
static size_t write_data(char *ptr, size_t size, size_t nmemb, void *arg) {
    size_t n=size*nmemb; transfer *t=arg;
    return t->callback(t->context,t->status,t->content_type,ptr,n);
}
/* A peer EOF cancels work; this listener requires clients to keep their write side
 * open while awaiting a response. POLLHUP/error and EOF are checked by libcurl's
 * progress callback even when the inference runtime is not sending data. */
static int peer_closed(int fd) {
    struct pollfd p={.fd=fd,.events=POLLIN};
    if(poll(&p,1,0)<=0)return 0;
    if(p.revents & (POLLHUP|POLLERR|POLLNVAL))return 1;
    if(p.revents & POLLIN) { char c; ssize_t n=recv(fd,&c,1,MSG_PEEK|MSG_DONTWAIT); if(n==0 || (n<0 && errno!=EAGAIN && errno!=EWOULDBLOCK && errno!=EINTR))return 1; }
    return 0;
}
static int cancelled(void *ctx,curl_off_t dt,curl_off_t dn,curl_off_t ut,curl_off_t un) {
    (void)dt;(void)dn;(void)ut;(void)un;
    return peer_closed(*(int *)ctx);
}
int upstream_perform(const yag_config *c, const char *path, const char *body, size_t len, yag_upstream_write cb, void *context, long *status, int cancel_fd) {
    size_t sz=strlen(c->upstream)+strlen(path)+1; char *url=malloc(sz); CURL *curl=curl_easy_init(); struct curl_slist *list=NULL; char *auth=NULL;
    int result=(int)CURLE_OUT_OF_MEMORY;
    if(!url || !curl) goto done;
    snprintf(url,sz,"%s%s",c->upstream,path);
    list=curl_slist_append(list,"Content-Type: application/json"); if(!list) goto done;
    if (*c->upstream_key) { size_t n=strlen(c->upstream_key)+23; auth=malloc(n); if(!auth) goto done; snprintf(auth,n,"Authorization: Bearer %s",c->upstream_key); struct curl_slist *next=curl_slist_append(list,auth); if(!next) goto done; list=next; }
    transfer t={.callback=cb,.context=context};
    curl_easy_setopt(curl,CURLOPT_URL,url); curl_easy_setopt(curl,CURLOPT_HTTPHEADER,list);
    curl_easy_setopt(curl,CURLOPT_CONNECTTIMEOUT,10L); curl_easy_setopt(curl,CURLOPT_TIMEOUT,c->timeout); curl_easy_setopt(curl,CURLOPT_NOSIGNAL,1L);
    curl_easy_setopt(curl,CURLOPT_FOLLOWLOCATION,0L); curl_easy_setopt(curl,CURLOPT_PROTOCOLS, CURLPROTO_HTTP|CURLPROTO_HTTPS);
    curl_easy_setopt(curl,CURLOPT_HEADERFUNCTION,headers); curl_easy_setopt(curl,CURLOPT_HEADERDATA,&t);
    curl_easy_setopt(curl,CURLOPT_WRITEFUNCTION,write_data); curl_easy_setopt(curl,CURLOPT_WRITEDATA,&t);
    if(cancel_fd>=0) { curl_easy_setopt(curl,CURLOPT_NOPROGRESS,0L); curl_easy_setopt(curl,CURLOPT_XFERINFOFUNCTION,cancelled); curl_easy_setopt(curl,CURLOPT_XFERINFODATA,&cancel_fd); }
    if(body) { curl_easy_setopt(curl,CURLOPT_POST,1L); curl_easy_setopt(curl,CURLOPT_POSTFIELDS,body); curl_easy_setopt(curl,CURLOPT_POSTFIELDSIZE_LARGE,(curl_off_t)len); }
    /* curl_easy_perform may sleep inside a quiet upstream transfer long enough
     * that progress callbacks are not invoked promptly. Multi polling gives us
     * a bounded opportunity to check the client socket every 100 ms. */
    CURLM *multi=curl_multi_init();
    if(!multi)goto done;
    CURLMcode mc=curl_multi_add_handle(multi,curl);
    if(mc==CURLM_OK) {
        int running=1;
        do {
            mc=curl_multi_perform(multi,&running);
            if(mc!=CURLM_OK)break;
            if(!running)break;
            int activity=0;
            mc=curl_multi_poll(multi,NULL,0,100,&activity);
            if(mc!=CURLM_OK)break;
            if(cancel_fd>=0 && peer_closed(cancel_fd)) {result=(int)CURLE_ABORTED_BY_CALLBACK;break;}
        } while(running);
        if(mc==CURLM_OK && result!=(int)CURLE_ABORTED_BY_CALLBACK) {
            int pending=0; CURLMsg *message;
            result=(int)CURLE_RECV_ERROR;
            while((message=curl_multi_info_read(multi,&pending)))
                if(message->msg==CURLMSG_DONE && message->easy_handle==curl) {result=(int)message->data.result;break;}
        }
        curl_multi_remove_handle(multi,curl);
    }
    curl_multi_cleanup(multi);
    if(status) *status=t.status;
done:
    free(auth); curl_slist_free_all(list); if(curl) curl_easy_cleanup(curl); free(url); return result;
}
/* The circuit breaker controls *admission* only: we never replay a request
 * after an HTTP response, timeout, or ambiguous transport outcome. One request
 * is allowed as a probe after cooldown; concurrent requests are bypassed. */
static int route_admitted(yag_config *cfg,yag_provider_stats *stats) {
    if(!cfg->circuit_threshold)return 1;
    int allowed=1;time_t now=time(NULL);
    pthread_mutex_lock(&cfg->lock);
    if(stats->open_until) {
        if(now<stats->open_until || stats->half_open_probe)allowed=0;
        else stats->half_open_probe=1;
    }
    if(!allowed)stats->bypassed++;
    pthread_mutex_unlock(&cfg->lock);
    return allowed;
}
static unsigned long elapsed_milliseconds(const struct timespec *start) {
    struct timespec end={0};
    if(clock_gettime(CLOCK_MONOTONIC,&end))return 0;
    long long sec=(long long)end.tv_sec-(long long)start->tv_sec;
    long long nsec=(long long)end.tv_nsec-(long long)start->tv_nsec;
    long long ms=sec*1000LL+nsec/1000000LL;
    return ms>0?(unsigned long)ms:0;
}
static void record_attempt(yag_config *cfg,yag_provider_stats *stats,
        int rc,long status,const struct timespec *start) {
    int ok=rc==CURLE_OK && status>=200 && status<400;
    /* 5xx and definite transport failures indicate provider instability.
     * 4xx are counted as unsuccessful requests, but prove reachability. */
    int unstable=(status>=500 || (!status && rc!=CURLE_OK
        && rc!=CURLE_ABORTED_BY_CALLBACK && rc!=CURLE_WRITE_ERROR));
    pthread_mutex_lock(&cfg->lock);
    stats->attempts++;
    stats->latency_ms+=elapsed_milliseconds(start);
    stats->last_http_status=status;
    if(ok)stats->successes++;else stats->failures++;
    if(!unstable) {
        stats->consecutive_failures=0;
        stats->open_until=0;
    } else {
        if(stats->consecutive_failures<1000000)stats->consecutive_failures++;
        if(cfg->circuit_threshold
            && stats->consecutive_failures>=cfg->circuit_threshold)
            stats->open_until=time(NULL)+(time_t)cfg->circuit_cooldown_seconds;
    }
    stats->half_open_probe=0;
    pthread_mutex_unlock(&cfg->lock);
}
/* A bounded, ephemeral observer for upstream Chat usage only. No prompt,
 * response content or serialized request is saved after this transfer. If the
 * response exceeds the bound, usage remains unknown rather than estimated. */
#define MAX_USAGE_CAPTURE (128*1024)
typedef struct {
    yag_upstream_write downstream;
    void *context;
    char *bytes;
    size_t size;
    int disabled;
    int sse;
    unsigned long long input,output;
    int observed;
} usage_capture;
static size_t capture_write(void *context,long status,const char *type,
        const char *data,size_t len) {
    usage_capture *cap=context;
    size_t written=cap->downstream(cap->context,status,type,data,len);
    if(written!=len || cap->disabled || status<200 || status>=300)return written;
    if(type && !strncmp(type,"text/event-stream",17))cap->sse=1;
    if(len>MAX_USAGE_CAPTURE || cap->size>MAX_USAGE_CAPTURE-len) {
        cap->disabled=1;
        free(cap->bytes);cap->bytes=NULL;cap->size=0;
        return written;
    }
    char *next=realloc(cap->bytes,cap->size+len+1);
    if(!next){cap->disabled=1;free(cap->bytes);cap->bytes=NULL;cap->size=0;return written;}
    cap->bytes=next;
    memcpy(cap->bytes+cap->size,data,len);
    cap->size+=len;
    cap->bytes[cap->size]=0;
    return written;
}
static void extract_usage(usage_capture *cap,yyjson_val *root) {
    yyjson_val *usage=yyjson_obj_get(root,"usage");
    yyjson_val *a=yyjson_obj_get(usage,"prompt_tokens");
    yyjson_val *b=yyjson_obj_get(usage,"completion_tokens");
    if(yyjson_is_uint(a) && yyjson_is_uint(b)) {
        cap->input=yyjson_get_uint(a);
        cap->output=yyjson_get_uint(b);
        cap->observed=1;
    }
}
static void parse_usage(usage_capture *cap) {
    if(cap->disabled || !cap->bytes || !cap->size)return;
    if(!cap->sse) {
        yyjson_doc *d=yyjson_read(cap->bytes,cap->size,0);
        if(d){extract_usage(cap,yyjson_doc_get_root(d));yyjson_doc_free(d);}
        return;
    }
    char *cursor=cap->bytes;
    while(*cursor) {
        char *newline=strchr(cursor,'\n');
        if(newline)*newline=0;
        if(!strncmp(cursor,"data:",5)) {
            char *item=cursor+5;
            if(*item==' ')item++;
            if(*item=='{') {
                yyjson_doc *d=yyjson_read(item,strlen(item),0);
                if(d){extract_usage(cap,yyjson_doc_get_root(d));yyjson_doc_free(d);}
            }
        }
        if(!newline)break;
        cursor=newline+1;
    }
}
static int measured_upstream(yag_config *cfg,const yag_config *target,
        yag_provider_stats *stats,const char *path,const char *body,size_t len,
        yag_upstream_write cb,void *ctx,long *status,int cancel_fd) {
    struct timespec start={0};
    clock_gettime(CLOCK_MONOTONIC,&start);
    usage_capture cap={.downstream=cb,.context=ctx};
    int rc=upstream_perform(target,path,body,len,capture_write,&cap,status,cancel_fd);
    if(rc==CURLE_OK && status && *status>=200 && *status<300)parse_usage(&cap);
    record_attempt(cfg,stats,rc,status?*status:0,&start);
    if(rc==CURLE_OK && status && *status>=200 && *status<300 && cap.observed) {
        pthread_mutex_lock(&cfg->lock);
        stats->prompt_tokens+=cap.input;
        stats->completion_tokens+=cap.output;
        stats->usage_samples++;
        pthread_mutex_unlock(&cfg->lock);
    }
    free(cap.bytes);
    return rc;
}
/* Replica pool: default upstream is slot zero. Optional explicit per-replica
 * model allowlists prevent requests being routed to unsupported replicas.
 * Empty allowlist (legacy config) means operator-asserted equivalent models.
 * Least-inflight selection and passive health cooldown apply afterward.
 * No ambiguous request is ever replayed. */
static int pool_choose(yag_config *cfg,const char *model) {
    int chosen=-1;
    unsigned lowest=0xffffffffu,best_priority=101u;
    time_t now=time(NULL);
    pthread_mutex_lock(&cfg->lock);
    size_t total=cfg->pool_count+1;
    for(size_t offset=0;offset<total;offset++) {
        size_t index=(cfg->pool_cursor+offset)%total;
        unsigned active=index==0?cfg->default_pool_active:
            cfg->pool[index-1].active;
        time_t until=index==0?cfg->default_pool_unavailable_until:
            cfg->pool[index-1].unavailable_until;
        if(until>now && (index!=0 || cfg->pool_count))continue;
        if(index>0 && !cfg->pool[index-1].enabled)continue;
        if(index>0 && cfg->pool[index-1].model_count) {
            int supported=0;
            for(size_t j=0;j<cfg->pool[index-1].model_count;j++)
                if(model && !strcmp(model,cfg->pool[index-1].models[j])) {
                    supported=1;break;
                }
            if(!supported)continue;
        }
        unsigned priority=index==0?50u:cfg->pool[index-1].priority;
        if(active<lowest || (active==lowest && priority<best_priority)) {
            lowest=active;best_priority=priority;chosen=(int)index;
        }
    }
    if(chosen>=0) {
        if(chosen==0)cfg->default_pool_active++;
        else cfg->pool[chosen-1].active++;
        cfg->pool_cursor=((unsigned)chosen+1u)%(unsigned)total;
    }
    pthread_mutex_unlock(&cfg->lock);
    return chosen;
}
static void pool_complete(yag_config *cfg,int index,int rc,long status) {
    int unstable=status>=500 || (status==0 && rc!=CURLE_OK
        && rc!=CURLE_ABORTED_BY_CALLBACK && rc!=CURLE_WRITE_ERROR);
    pthread_mutex_lock(&cfg->lock);
    unsigned *active=index==0?&cfg->default_pool_active:
        &cfg->pool[index-1].active;
    unsigned *failures=index==0?&cfg->default_pool_failures:
        &cfg->pool[index-1].consecutive_failures;
    time_t *until=index==0?&cfg->default_pool_unavailable_until:
        &cfg->pool[index-1].unavailable_until;
    if(*active)(*active)--;
    if(unstable) {
        if(*failures<1000000)(*failures)++;
        if(*failures>=2)*until=time(NULL)+30;
    } else if(rc==CURLE_OK) {
        *failures=0;
        *until=0;
    }
    pthread_mutex_unlock(&cfg->lock);
}
void provider_pool_status_handle(int fd,yag_config *cfg) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);
    if(!d){reply(fd,500,"application/json",
        "{\"error\":{\"message\":\"Out of memory\"}}");return;}
    yyjson_mut_val *root=yyjson_mut_obj(d);
    yyjson_mut_val *items=root?yyjson_mut_obj_add_arr(d,root,"data"):NULL;
    int ok=root && items && yyjson_mut_obj_add_str(d,root,"object","gateway.pool");
    pthread_mutex_lock(&cfg->lock);
    if(ok)ok=yyjson_mut_obj_add_uint(d,root,"replica_count",cfg->pool_count+1);
    for(size_t i=0;ok && i<=cfg->pool_count;i++) {
        yag_provider_stats *stats=i==0?&cfg->default_provider_stats:
            &cfg->pool[i-1].stats;
        unsigned active=i==0?cfg->default_pool_active:
            cfg->pool[i-1].active;
        time_t until=i==0?cfg->default_pool_unavailable_until:
            cfg->pool[i-1].unavailable_until;
        time_t now=time(NULL);
        yyjson_mut_val *item=yyjson_mut_obj(d);
        ok=item && yyjson_mut_obj_add_uint(d,item,"index",i)
            && yyjson_mut_obj_add_str(d,item,"role",i==0?"primary":"replica")
            && yyjson_mut_obj_add_uint(d,item,"active_requests",active)
            && yyjson_mut_obj_add_uint(d,item,"attempts",stats->attempts)
            && yyjson_mut_obj_add_uint(d,item,"successes",stats->successes)
            && yyjson_mut_obj_add_uint(d,item,"failures",stats->failures)
            && yyjson_mut_obj_add_uint(d,item,"cooldown_seconds",
                 until>now?(unsigned long)(until-now):0u);
        yyjson_mut_val *declared=ok?yyjson_mut_obj_add_arr(d,item,"declared_models"):NULL;
        if(!declared)ok=0;
        if(ok && i>0)for(size_t j=0;j<cfg->pool[i-1].model_count;j++)
            if(!yyjson_mut_arr_add_str(d,declared,cfg->pool[i-1].models[j])) {
                ok=0;break;
            }
        if(ok)ok=yyjson_mut_obj_add_bool(d,item,"model_allowlist_enabled",
                        i>0 && cfg->pool[i-1].model_count>0)
                  && yyjson_mut_obj_add_bool(d,item,"enabled",
                        i==0 || cfg->pool[i-1].enabled)
                  && yyjson_mut_obj_add_uint(d,item,"priority",
                        i==0?50u:cfg->pool[i-1].priority)
                  && yyjson_mut_arr_add_val(items,item);
    }
    pthread_mutex_unlock(&cfg->lock);
    if(ok)yyjson_mut_doc_set_root(d,root);
    char *json=ok?yyjson_mut_write(d,0,NULL):NULL;
    if(json)reply(fd,200,"application/json",json);
    else reply(fd,500,"application/json",
        "{\"error\":{\"message\":\"Pool serialization failed\"}}");
    free(json);yyjson_mut_doc_free(d);
}
/* Retry only when connection setup definitively failed before receiving an
 * HTTP response. Timeouts are ambiguous; never retry those. */
int upstream_for_model(const yag_config *c,const char *model,const char *path,
        const char *body,size_t len,yag_upstream_write cb,void *ctx,long *status,int cancel_fd) {
    yag_config *state=(yag_config *)c; /* mutable statistics protected by lock */
    yag_provider_stats *stats=&state->default_provider_stats;
    for(size_t i=0;model && i<c->route_count;i++)
        if(!strcmp(model,c->routes[i].model)){stats=&state->routes[i].stats;break;}
    yag_config selected={0};
    const yag_config *target=config_for_model(c,model,&selected);
    /* Track even the single-primary case so live pool edits cannot race an
     * untracked in-flight request (especially when adding first replica). */
    if(target==c) {
        int index=pool_choose(state,model);
        if(index<0) {
            if(status)*status=0;
            return CURLE_COULDNT_CONNECT;
        }
        const yag_config *replica=c;
        if(index>0) {
            selected.upstream=c->pool[index-1].url;
            selected.upstream_key=c->pool[index-1].key;
            selected.timeout=c->timeout;
            replica=&selected;
        }
        yag_provider_stats *entry=index==0?
            &state->default_provider_stats:&state->pool[index-1].stats;
        int rc=measured_upstream(state,replica,entry,path,body,len,
                                 cb,ctx,status,cancel_fd);
        long code=status?*status:0;
        pool_complete(state,index,rc,code);
        if(index>0 && c->fallback_to_default && !code
            && (rc==CURLE_COULDNT_CONNECT || rc==CURLE_COULDNT_RESOLVE_HOST)) {
            pthread_mutex_lock(&state->lock);
            entry->fallthroughs++;
            pthread_mutex_unlock(&state->lock);
            if(status)*status=0;
            return measured_upstream(state,c,&state->default_provider_stats,
                path,body,len,cb,ctx,status,cancel_fd);
        }
        return rc;
    }
    if(target!=c && !route_admitted(state,stats)) {
        if(c->fallback_to_default) {
            pthread_mutex_lock(&state->lock);
            stats->fallthroughs++;
            pthread_mutex_unlock(&state->lock);
            if(status)*status=0;
            return measured_upstream(state,c,&state->default_provider_stats,
                path,body,len,cb,ctx,status,cancel_fd);
        }
        if(status)*status=0;
        return CURLE_COULDNT_CONNECT;
    }
    int rc=measured_upstream(state,target,stats,path,body,len,cb,ctx,status,cancel_fd);
    if(c->fallback_to_default && target!=c && (!status || !*status)
        && (rc==CURLE_COULDNT_CONNECT || rc==CURLE_COULDNT_RESOLVE_HOST)) {
        pthread_mutex_lock(&state->lock);
        stats->fallthroughs++;
        pthread_mutex_unlock(&state->lock);
        if(status)*status=0;
        return measured_upstream(state,c,&state->default_provider_stats,
            path,body,len,cb,ctx,status,cancel_fd);
    }
    return rc;
}
static size_t proxy_write(void *ctx,long status,const char *type,const char *data,size_t n) {
    transfer *t=ctx; t->status=status;
    snprintf(t->content_type,sizeof t->content_type,"%s",type); start(t);
    return send_all(t->fd,data,n)==0?n:0;
}
void upstream_request(int fd, const yag_config *c, const char *path, const char *body, size_t len, const char *model) {
    transfer t={.fd=fd}; long status=0;
    int res=upstream_for_model(c,model,path,body,len,proxy_write,&t,&status,fd);
    if(res!=CURLE_OK && !t.sent) reply(fd,res==CURLE_OPERATION_TIMEDOUT?504:502,"application/json","{\"error\":{\"message\":\"Inference backend unavailable or timed out\",\"type\":\"upstream_error\"}}");
    else if(!t.sent) { t.status=status; start(&t); }
}
