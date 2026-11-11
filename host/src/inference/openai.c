#include "yag.h"
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <poll.h>
#include <sys/socket.h>
#include <errno.h>
#include <time.h>

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
/* Transport outcomes and coarse latency are metadata only: no payload, tokens
 * or per-key identity is captured. Time is monotonic for duration math. */
static unsigned long elapsed_ms(const struct timespec *start) {
    struct timespec now;
    if(clock_gettime(CLOCK_MONOTONIC,&now))return 0;
    long sec=now.tv_sec-start->tv_sec,ns=now.tv_nsec-start->tv_nsec;
    long long ms=(long long)sec*1000+ns/1000000;
    return ms>0?(unsigned long)ms:0;
}
static void record_attempt(const yag_config *cfg,int rc,long status,unsigned long ms) {
    yag_config *c=(yag_config *)cfg;
    pthread_mutex_lock(&c->lock);
    c->upstream_attempts++;
    c->upstream_total_latency_ms+=ms;
    if(rc!=CURLE_OK)c->upstream_transport_failures++;
    else if(status>=400 || status<200)c->upstream_http_errors++;
    else c->upstream_successes++;
    pthread_mutex_unlock(&c->lock);
}
static int tracked_perform(const yag_config *root,const yag_config *target,
    const char *path,const char *body,size_t len,yag_upstream_write cb,
    void *ctx,long *status,int fd) {
    struct timespec start={0};
    clock_gettime(CLOCK_MONOTONIC,&start);
    int result=upstream_perform(target,path,body,len,cb,ctx,status,fd);
    record_attempt(root,result,status?*status:0,elapsed_ms(&start));
    return result;
}
/* An open circuit prevents repeated connection attempts only for a configured
 * route. Failover is opt-in; never retry after an upstream responded or timed out.
 * A route becomes eligible again when the cooldown expires. */
int upstream_for_model(const yag_config *cfg,const char *model,const char *path,
        const char *body,size_t len,yag_upstream_write cb,void *ctx,long *status,int cancel_fd) {
    yag_config *c=(yag_config *)cfg;
    yag_config selected={0};
    const yag_config *target=config_for_model(cfg,model,&selected);
    yag_route *route=NULL;
    if(target!=cfg && model)
        for(size_t i=0;i<c->route_count;i++)
            if(!strcmp(c->routes[i].model,model)){route=&c->routes[i];break;}
    int blocked=0;
    if(route && c->circuit_failure_threshold) {
        pthread_mutex_lock(&c->lock);
        time_t now=time(NULL);
        blocked=route->circuit_open_until>now;
        if(blocked)c->circuit_rejections++;
        pthread_mutex_unlock(&c->lock);
    }
    if(blocked) {
        if(status)*status=0;
        if(c->fallback_to_default)
            return tracked_perform(cfg,c,path,body,len,cb,ctx,status,cancel_fd);
        return CURLE_COULDNT_CONNECT;
    }
    int rc=tracked_perform(cfg,target,path,body,len,cb,ctx,status,cancel_fd);
    int connection_failure=(rc==CURLE_COULDNT_CONNECT || rc==CURLE_COULDNT_RESOLVE_HOST)
        && (!status || !*status);
    if(route && c->circuit_failure_threshold) {
        pthread_mutex_lock(&c->lock);
        if(connection_failure) {
            if(route->consecutive_connect_failures<c->circuit_failure_threshold)
                route->consecutive_connect_failures++;
            if(route->consecutive_connect_failures>=c->circuit_failure_threshold)
                route->circuit_open_until=time(NULL)+c->circuit_cooldown_seconds;
        } else if(rc==CURLE_OK) {
            route->consecutive_connect_failures=0;
            route->circuit_open_until=0;
        }
        pthread_mutex_unlock(&c->lock);
    }
    if(c->fallback_to_default && target!=cfg && connection_failure) {
        if(status)*status=0;
        return tracked_perform(cfg,c,path,body,len,cb,ctx,status,cancel_fd);
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
