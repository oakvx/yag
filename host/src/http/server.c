#include "yag.h"
#include "yyjson.h"
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/time.h>
#include <netdb.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <errno.h>
#include <signal.h>
#include <poll.h>
#include <time.h>
/* On Linux a disconnected peer must not terminate the whole gateway via SIGPIPE. */
#ifdef MSG_NOSIGNAL
#define YAG_SEND_FLAGS MSG_NOSIGNAL
#else
#define YAG_SEND_FLAGS 0
#endif
#define MAX_HEADER 16384
#define MAX_BODY (1024*1024)
#define MAX_CONNECTIONS 32

static volatile sig_atomic_t stop_requested=0;
static void request_stop(int signum) {(void)signum;stop_requested=1;}
typedef struct { int fd; yag_config *cfg; } client;
int send_all(int fd,const void *data,size_t len) { const char *p=data; while(len){ ssize_t n=send(fd,p,len,YAG_SEND_FLAGS); if(n<0 && errno==EINTR) continue; if(n<=0) return -1; p+=n; len-=(size_t)n; } return 0; }
void reply(int fd,int status,const char *type,const char *body) {
    char h[512]; size_t len=strlen(body); int n=snprintf(h,sizeof h,"HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",status,status==200?"OK":"Error",type,len);
    if(n>0 && (size_t)n<sizeof h && !send_all(fd,h,(size_t)n)) send_all(fd,body,len);
}
static void error(int fd,int status,const char *msg) { char b[512]; snprintf(b,sizeof b,"{\"error\":{\"message\":\"%s\"}}",msg); reply(fd,status,"application/json",b); }
static int key_equal(const char *a,const char *b) { size_t na=strlen(a),nb=strlen(b),n=na>nb?na:nb; unsigned diff=(unsigned)(na^nb); for(size_t i=0;i<n;i++) diff|=(unsigned char)(i<na?a[i]:0)^(unsigned char)(i<nb?b[i]:0); return diff==0; }
static int authenticated_raw_key(const yag_config *c,const char *candidate) {
    if(!candidate)return -1;
    int match=key_equal(candidate,c->api_key)?0:-1;
    for(size_t i=0;i<c->extra_key_count;i++)
        if(key_equal(candidate,c->extra_keys[i]))match=(int)i+1;
    return match;
}
static int authenticated_key(const yag_config *c,const char *authorization) {
    if(!authorization || strncmp(authorization,"Bearer ",7))return -1;
    return authenticated_raw_key(c,authorization+7);
}
static int rate_permit(yag_config *c,int key_index) {
    if(!c->rate_limit_per_minute)return 1;
    time_t now=time(NULL);
    pthread_mutex_lock(&c->lock);
    if(now<c->rate_windows[key_index] || now-c->rate_windows[key_index]>=60) {
        c->rate_windows[key_index]=now;
        c->rate_counts[key_index]=0;
    }
    int permit=c->rate_counts[key_index]<c->rate_limit_per_minute;
    if(permit)c->rate_counts[key_index]++;
    pthread_mutex_unlock(&c->lock);
    return permit;
}
static void increment(yag_config *cfg,unsigned long *counter) {
    pthread_mutex_lock(&cfg->lock);
    (*counter)++;
    pthread_mutex_unlock(&cfg->lock);
}
static void metrics(int fd,yag_config *cfg) {
    char out[512];
    pthread_mutex_lock(&cfg->lock);
    int n=snprintf(out,sizeof out,
        "{\"object\":\"gateway.metrics\",\"chat_requests\":%lu,"
        "\"responses_requests\":%lu,\"anthropic_requests\":%lu,"
        "\"model_list_requests\":%lu,\"provider_check_requests\":%lu}",
        cfg->chat_requests,cfg->responses_requests,cfg->anthropic_requests,
        cfg->model_list_requests,cfg->provider_check_requests);
    pthread_mutex_unlock(&cfg->lock);
    if(n<0 || (size_t)n>=sizeof out)error(fd,500,"Could not serialize metrics");
    else reply(fd,200,"application/json",out);
}
/* Resolve every asset path component without following symlinks. Merely
 * rejecting ".." is insufficient: an asset-tree symlink can escape its root. */
static FILE *open_asset(const char *root,const char *rel,long *length) {
    int directory=open(root,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);
    if(directory<0)return NULL;
    char *path=strdup(rel+1),*save=NULL;
    if(!path){close(directory);return NULL;}
    char *part=strtok_r(path,"/",&save);
    int fd=-1;
    while(part) {
        char *next=strtok_r(NULL,"/",&save);
        if(!strcmp(part,".") || !strcmp(part,".."))break;
        int flags=O_RDONLY|O_CLOEXEC|O_NOFOLLOW|(next?O_DIRECTORY:0);
        fd=openat(directory,part,flags);
        close(directory);directory=-1;
        if(fd<0)break;
        if(!next) {
            struct stat st;
            if(fstat(fd,&st)==0 && S_ISREG(st.st_mode)
                && st.st_size>=0 && st.st_size<=10*1024*1024) {
                *length=(long)st.st_size;
                FILE *file=fdopen(fd,"rb");
                if(file){free(path);return file;}
            }
            close(fd);fd=-1;break;
        }
        directory=fd;
        part=next;
    }
    if(directory>=0)close(directory);
    free(path);
    return NULL;
}
static void capabilities(int fd,const yag_config *cfg) {
    /* Reports gateway translation features, not a particular model's abilities. */
    char body[1536];
    int n=snprintf(body,sizeof body,
        "{\"object\":\"gateway.capabilities\",\"api_version\":\"experimental-1\","
        "\"routing\":{\"configured_routes\":%zu,\"fallback_enabled\":%s},"
        "\"protocols\":{"
        "\"chat_completions\":{\"streaming\":true,\"tool_calls\":\"upstream_passthrough\"},"
        "\"responses\":{\"streaming\":true,\"function_tools\":true,"
            "\"namespace_functions\":true,\"stateful\":false,\"web_search\":false},"
        "\"anthropic_messages\":{\"streaming\":true,\"function_tools\":true,"
            "\"tool_result_replay\":true,\"thinking\":\"best_effort_effort_mapping\","
            "\"count_tokens\":false,\"multimodal\":false}},"
        "\"limits\":{\"max_body_bytes\":%d,\"max_connections\":%d}}",
        cfg->route_count,cfg->fallback_to_default?"true":"false",
        MAX_BODY,MAX_CONNECTIONS);
    if(n<0 || (size_t)n>=sizeof body)error(fd,500,"Could not describe capabilities");
    else reply(fd,200,"application/json",body);
}
static void asset(int fd,const yag_config *c,const char *uri) {
    const char *rel=!strcmp(uri,"/")?"/index.html":uri;
    if(strstr(rel,"..") || strpbrk(rel,"%\\?") || strlen(rel)>512
        || rel[0]!='/' || rel[strlen(rel)-1]=='/') {
        error(fd,404,"Not found");return;
    }
    long len=0;
    FILE *f=open_asset(c->assets,rel,&len);
    if(!f){error(fd,404,"Not found");return;}
    const char *type="application/octet-stream";const char *ext=strrchr(rel,'.');
    if(ext && !strcmp(ext,".html"))type="text/html; charset=utf-8";
    else if(ext && !strcmp(ext,".js"))type="text/javascript; charset=utf-8";
    else if(ext && !strcmp(ext,".css"))type="text/css; charset=utf-8";
    else if(ext && !strcmp(ext,".svg"))type="image/svg+xml";
    char h[512];int n=snprintf(h,sizeof h,
        "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %ld\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'\r\n"
        "Connection: close\r\n\r\n",type,len);
    if(n>0 && (size_t)n<sizeof h && !send_all(fd,h,(size_t)n)) {
        char b[8192];size_t got;
        while((got=fread(b,1,sizeof b,f)))if(send_all(fd,b,got))break;
    }
    fclose(f);
}
/* Diagnostics expose route categories only; never log prompt contents,
 * authentication headers, URL query strings or arbitrary path segments. */
static const char *trace_route(const char *uri) {
    if(!strcmp(uri,"/health"))return "health";
    if(!strcmp(uri,"/v1/models"))return "models-list";
    if(!strncmp(uri,"/v1/models/",11))return "models-detail";
    if(!strcmp(uri,"/v1/messages"))return "messages";
    if(!strcmp(uri,"/v1/messages/count_tokens"))return "messages-count";
    if(!strcmp(uri,"/v1/responses"))return "responses";
    if(!strcmp(uri,"/v1/chat/completions"))return "chat";
    if(!strncmp(uri,"/api/",5))return "admin";
    return "other";
}
/* Absolute monotonic deadlines prevent a peer from extending a read forever
 * by sending one byte just before a per-recv socket timeout expires. */
static int recv_before_deadline(int fd,char *dst,size_t cap,
        const struct timespec *start,unsigned seconds) {
    for(;;) {
        struct timespec now={0};clock_gettime(CLOCK_MONOTONIC,&now);
        long long elapsed=(long long)(now.tv_sec-start->tv_sec)*1000
            +(now.tv_nsec-start->tv_nsec)/1000000LL;
        long long left=(long long)seconds*1000-elapsed;
        if(left<=0)return -2;
        struct pollfd descriptor={.fd=fd,.events=POLLIN};
        int ready=poll(&descriptor,1,left>2147483647LL?2147483647:(int)left);
        if(ready==0)return -2;
        if(ready<0){if(errno==EINTR)continue;return -1;}
        ssize_t got=recv(fd,dst,cap,0);
        if(got<0 && errno==EINTR)continue;
        if(got<0 && (errno==EAGAIN || errno==EWOULDBLOCK))continue;
        return got>0?(int)got:-1;
    }
}
/* Optional fail-fast guard over *declared* operator capability hints.
 * Unknown model IDs are not presumed capable or incapable; downstream
 * validation remains authoritative. This is not feature discovery. */
static int capability_rejected(int fd,const yag_config *cfg,yyjson_val *request) {
    if(!cfg->enforce_model_capabilities || !yyjson_is_obj(request))return 0;
    yyjson_val *name=yyjson_obj_get(request,"model");
    if(!yyjson_is_str(name) || !yyjson_get_len(name)
        || strlen(yyjson_get_str(name))!=yyjson_get_len(name))return 0;
    const yag_model_capability *cap=NULL;
    for(size_t i=0;i<cfg->capability_count;i++)
        if(yyjson_equals_str(name,cfg->capabilities[i].model)) {
            cap=&cfg->capabilities[i];break;
        }
    if(!cap)return 0;
    yyjson_val *tools=yyjson_obj_get(request,"tools");
    yyjson_val *stream=yyjson_obj_get(request,"stream");
    yyjson_val *thinking=yyjson_obj_get(request,"thinking");
    yyjson_val *reasoning=yyjson_obj_get(request,"reasoning");
    yyjson_val *effort=yyjson_obj_get(request,"reasoning_effort");
    yyjson_val *format=yyjson_obj_get(yyjson_obj_get(request,"text"),"format");
    if(yyjson_is_arr(tools) && yyjson_arr_size(tools)
        && !(cap->feature_mask&(1u<<1))) {
        error(fd,422,"Declared model lacks function_tools");return 1;
    }
    if(yyjson_is_true(stream) && !(cap->feature_mask&1u)) {
        error(fd,422,"Declared model lacks streaming");return 1;
    }
    int needs_reasoning=(thinking
        && !yyjson_equals_str(yyjson_obj_get(thinking,"type"),"disabled"))
        || (reasoning && !yyjson_equals_str(yyjson_obj_get(reasoning,"effort"),"none"))
        || (effort && !yyjson_equals_str(effort,"none"));
    if(needs_reasoning && !(cap->feature_mask&(1u<<3))) {
        error(fd,422,"Declared model lacks reasoning");return 1;
    }
    if(yyjson_equals_str(yyjson_obj_get(format,"type"),"json_schema")
        && !(cap->feature_mask&(1u<<2))) {
        error(fd,422,"Declared model lacks json_schema");return 1;
    }
    return 0;
}
static void handle(int fd,yag_config *c) {
    char *buf=malloc(MAX_HEADER+1); if(!buf){error(fd,500,"Out of memory");return;} size_t used=0,header_len=0;
    struct timespec header_start={0};clock_gettime(CLOCK_MONOTONIC,&header_start);
    while(used<MAX_HEADER){
        int n=recv_before_deadline(fd,buf+used,MAX_HEADER-used,&header_start,c->header_deadline_seconds);
        if(n==-2){error(fd,408,"Request headers timed out");goto done;}
        if(n<=0)goto done;
        used+=(size_t)n;buf[used]=0;
        char *p=strstr(buf,"\r\n\r\n");
        if(p){header_len=(size_t)(p-buf)+4;break;}
    }
    if(!header_len){error(fd,431,"Headers too large or invalid");goto done;}
    /* Reject NUL and malformed framing to avoid ambiguous request interpretation. */
    if(memchr(buf,0,header_len)){error(fd,400,"Invalid headers");goto done;}
    char *line_end=strstr(buf,"\r\n"); if(!line_end){error(fd,400,"Invalid request");goto done;} *line_end=0;
    char method[8],uri[1024],version[16],extra; if(sscanf(buf,"%7s %1023s %15s %c",method,uri,version,&extra)!=3 || (strcmp(version,"HTTP/1.1") && strcmp(version,"HTTP/1.0")) || uri[0]!='/'){error(fd,400,"Invalid request line");goto done;}
    /* Claude Code sends POST /v1/messages?beta=true.
     * Match the API path separately and support only the known query marker;
     * other query semantics must not be ignored silently. */
    char *question=strchr(uri,'?');
    if(question && (!strncmp(uri,"/v1/messages?",13)
        || !strncmp(uri,"/v1/messages/count_tokens?",26))) {
        if(strcmp(question,"?beta=true")){error(fd,400,"Unsupported Messages query parameters");goto done;}
        *question=0;
    }
    const char *trace=getenv("YAG_TRACE_ROUTES");
    if(trace && !strcmp(trace,"1")) {
        const char *kind=trace_route(uri);
        if(strcmp(kind,"other"))
            fprintf(stderr,"YAG request method=%s route=%s\n",method,kind);
        else fprintf(stderr,"YAG request method=%s route=other has_query=%d\n",
            method,strchr(uri,'?')!=NULL);
    }
    size_t length=0; int have_length=0,have_auth=0,have_native_key=0,have_expect=0,expect_continue=0,transfer_encoding=0; char *auth=NULL,*native_key=NULL; char *line=line_end+2;
    while(line<buf+header_len-2) { char *end=strstr(line,"\r\n"); if(!end || end==line) break; *end=0; char *colon=strchr(line,':'); if(!colon || colon==line){error(fd,400,"Malformed header");goto done;} *colon=0;
        /* RFC 9110 field names contain token characters only; rejecting whitespace
         * before ':' avoids proxy/backend framing disagreements. */
        for(char *p=line;*p;p++) {
            unsigned char ch=(unsigned char)*p;
            if(!isalnum(ch) && !strchr("!#$%&'*+-.^_`|~",ch)) {
                error(fd,400,"Invalid header name");goto done;
            }
        }
        char *v=colon+1; while(*v==' '||*v=='\t')v++; char *tail=v+strlen(v); while(tail>v && (tail[-1]==' '||tail[-1]=='\t')) *--tail=0;
        if(!strcasecmp(line,"Content-Length")) { if(have_length++ || !*v){error(fd,400,"Invalid content length");goto done;} for(char *p=v;*p;p++) if(!isdigit((unsigned char)*p)){error(fd,400,"Invalid content length");goto done;} errno=0; unsigned long long x=strtoull(v,NULL,10); if(errno || x>MAX_BODY){error(fd,413,"Request too large");goto done;} length=(size_t)x; }
        else if(!strcasecmp(line,"Transfer-Encoding")) transfer_encoding=1;
        else if(!strcasecmp(line,"Expect")) {
            if(have_expect++ || strcasecmp(v,"100-continue")) {
                error(fd,417,"Unsupported expectation");goto done;
            }
            expect_continue=1;
        }
        else if(!strcasecmp(line,"Authorization")) { if(have_auth++){error(fd,400,"Duplicate authorization");goto done;} auth=v; }
        else if(!strcasecmp(line,"X-API-Key")) { if(have_native_key++){error(fd,400,"Duplicate API key");goto done;} native_key=v; }
        line=end+2;
    }
    if(transfer_encoding){error(fd,400,"Transfer-Encoding is not supported");goto done;}
    if(!strcmp(method,"POST") && !have_length){error(fd,411,"Content-Length required");goto done;}
    /* Authenticate from headers BEFORE buffering potentially large request bodies.
     * Never let an unauthenticated client monopolize an active worker on a slow POST. */
    int api=!strncmp(uri,"/v1/",4) || !strncmp(uri,"/api/",5);
    if(api) {
        int is_messages=!strcmp(uri,"/v1/messages") || !strcmp(uri,"/v1/messages/count_tokens");
        if(is_messages && auth && native_key){error(fd,400,"Choose one authentication header");goto done;}
        int key_index=auth?authenticated_key(c,auth):
            (is_messages && native_key?authenticated_raw_key(c,native_key):-1);
        if(key_index<0){error(fd,401,"Invalid API key");goto done;}
        /* Only the primary key may trigger active network probes. A scoped
         * extra key can be restricted to inference, discovery or read-only
         * monitoring without access to provider probe operations. */
        unsigned required=!strcmp(uri,"/api/provider/check")?8u:
            !strcmp(uri,"/v1/models")?2u:!strncmp(uri,"/v1/",4)?1u:4u;
        unsigned scope=key_index==0?15u:c->extra_key_scopes[key_index-1];
        if(!(scope&required)){error(fd,403,"Insufficient API key scope");goto done;}
        if(!rate_permit(c,key_index)){error(fd,429,"Rate limit exceeded");goto done;}
    }
    /* Send 100 Continue only AFTER authenticating and checking request size. */
    if(expect_continue && !strcmp(method,"POST") && used-header_len<length) {
        static const char interim[]="HTTP/1.1 100 Continue\r\n\r\n";
        if(send_all(fd,interim,sizeof interim-1))goto done;
    }
    /* Header-only connections allocate ~16 KiB instead of 1 MiB each.
     * Authentication and rate checks run before expanding the request buffer. */
    if(length) {
        char *expanded=realloc(buf,MAX_HEADER+length+1);
        if(!expanded){error(fd,500,"Out of memory");goto done;}
        buf=expanded;
    }
    struct timespec body_start={0};clock_gettime(CLOCK_MONOTONIC,&body_start);
    while(used-header_len<length) {
        int n=recv_before_deadline(fd,buf+used,length-(used-header_len),
            &body_start,c->body_deadline_seconds);
        if(n==-2){error(fd,408,"Request body timed out");goto done;}
        if(n<=0)goto done;
        used+=(size_t)n;
    }
    char *body=buf+header_len; body[length]=0;
    if(!strcmp(uri,"/health") && !strcmp(method,"GET")){reply(fd,200,"application/json","{\"status\":\"ok\"}");goto done;}
    if(!api){ if(!strcmp(method,"GET"))asset(fd,c,uri);else error(fd,405,"Method not allowed");goto done; }
    if(!strcmp(uri,"/api/status") && !strcmp(method,"GET")) { char out[256]; pthread_mutex_lock(&c->lock); unsigned active=c->active; unsigned long total=c->total; pthread_mutex_unlock(&c->lock); snprintf(out,sizeof out,"{\"status\":\"ok\",\"uptime_seconds\":%ld,\"active_connections\":%u,\"total_connections\":%lu}",(long)(time(NULL)-c->started),active,total);reply(fd,200,"application/json",out); }
    else if(!strcmp(uri,"/api/metrics") && !strcmp(method,"GET")) metrics(fd,c);
    else if(!strcmp(uri,"/api/capabilities") && !strcmp(method,"GET")) capabilities(fd,c);
    else if(!strcmp(uri,"/api/models/capabilities") && !strcmp(method,"GET")) model_capabilities_handle(fd,c);
    else if(!strcmp(uri,"/api/providers/status") && !strcmp(method,"GET")) providers_status_handle(fd,c);
    else if(!strcmp(uri,"/api/routes") && !strcmp(method,"GET")) {
        yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);
        if(!d){error(fd,500,"Out of memory");goto done;}
        yyjson_mut_val *root=yyjson_mut_obj(d),*routes=yyjson_mut_obj_add_arr(d,root,"data");
        if(!root || !routes){yyjson_mut_doc_free(d);error(fd,500,"Out of memory");goto done;}
        yyjson_mut_obj_add_str(d,root,"object","list");
        for(size_t i=0;i<c->route_count;i++) {
            yyjson_mut_val *route=yyjson_mut_obj(d);
            yyjson_mut_obj_add_strcpy(d,route,"model",c->routes[i].model);
            yyjson_mut_arr_add_val(routes,route);
        }
        yyjson_mut_doc_set_root(d,root);
        char *serialized=yyjson_mut_write(d,0,NULL);
        if(serialized)reply(fd,200,"application/json",serialized);
        else error(fd,500,"Could not serialize routes");
        free(serialized);yyjson_mut_doc_free(d);
    }
    else if(!strcmp(uri,"/api/provider/check") && !strcmp(method,"POST")) {
        increment(c,&c->provider_check_requests);
        provider_check_handle(fd,c,body,length);
    }
    else if(!strcmp(uri,"/v1/models") && !strcmp(method,"GET")) {
        increment(c,&c->model_list_requests);
        models_handle(fd,c);
    }
    else if(!strcmp(uri,"/v1/chat/completions") && !strcmp(method,"POST")) {
        increment(c,&c->chat_requests);
        yyjson_doc *doc=yyjson_read(body,length,0); yyjson_val *root=doc?yyjson_doc_get_root(doc):NULL;
        if(!yyjson_is_obj(root) || !yyjson_is_str(yyjson_obj_get(root,"model")) || !yyjson_is_arr(yyjson_obj_get(root,"messages"))) error(fd,400,"Expected JSON object with model string and messages array");
        else if(!capability_rejected(fd,c,root))
            upstream_request(fd,c,"/chat/completions",body,length,yyjson_get_str(yyjson_obj_get(root,"model")));
        yyjson_doc_free(doc);
    } else if(!strcmp(uri,"/v1/responses") && !strcmp(method,"POST")) {
        increment(c,&c->responses_requests);
        yyjson_doc *parsed=yyjson_read(body,length,0);
        if(!capability_rejected(fd,c,parsed?yyjson_doc_get_root(parsed):NULL))
            responses_handle(fd,c,body,length);
        yyjson_doc_free(parsed);
    }
    else if(!strcmp(uri,"/v1/messages") && !strcmp(method,"POST")) {
        increment(c,&c->anthropic_requests);
        yyjson_doc *parsed=yyjson_read(body,length,0);
        if(!capability_rejected(fd,c,parsed?yyjson_doc_get_root(parsed):NULL))
            anthropic_messages_handle(fd,c,body,length);
        yyjson_doc_free(parsed);
    }
    else if(!strcmp(uri,"/v1/messages/count_tokens")) error(fd,501,"Anthropic token counting not implemented");
    else if(!strcmp(uri,"/v1/messages")) error(fd,405,"Method not allowed");
    else error(fd,404,"Not found");
done: free(buf);
}
static void *worker(void *arg) { client *cl=arg; int fd=cl->fd; yag_config *c=cl->cfg; free(cl); struct timeval tv={.tv_sec=15}; setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&tv,sizeof tv); setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&tv,sizeof tv); handle(fd,c); close(fd); pthread_mutex_lock(&c->lock); c->active--;
    if(!c->active)pthread_cond_broadcast(&c->drained);
    pthread_mutex_unlock(&c->lock); return NULL; }
int server_run(yag_config *c) {
    struct addrinfo hints={0},*res=NULL,*p; hints.ai_family=AF_UNSPEC; hints.ai_socktype=SOCK_STREAM; hints.ai_flags=AI_PASSIVE;
    int e=getaddrinfo(c->bind,c->port,&hints,&res); if(e){fprintf(stderr,"Listen address: %s\n",gai_strerror(e));return -1;}
    int sock=-1; for(p=res;p;p=p->ai_next){ sock=socket(p->ai_family,p->ai_socktype,p->ai_protocol);if(sock<0)continue; int yes=1; setsockopt(sock,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof yes); if(!bind(sock,p->ai_addr,p->ai_addrlen) && !listen(sock,64))break; close(sock);sock=-1; } freeaddrinfo(res); if(sock<0){perror("listen");return -1;}
    stop_requested=0;
    struct sigaction action={0};
    action.sa_handler=request_stop;
    sigemptyset(&action.sa_mask);
    sigaction(SIGINT,&action,NULL);
    sigaction(SIGTERM,&action,NULL);
    /* Periodically return from accept to observe shutdown even when a signal
     * is handled by another worker thread. */
    struct timeval accept_timeout={.tv_sec=1};
    setsockopt(sock,SOL_SOCKET,SO_RCVTIMEO,&accept_timeout,sizeof accept_timeout);
    fprintf(stderr,"YAG listening on %s:%s\n",c->bind,c->port);
    int failure=0;
    for(;;){ if(stop_requested)break; int fd=accept(sock,NULL,NULL);
        if(fd<0){
            if(errno==EINTR || errno==EAGAIN || errno==EWOULDBLOCK)continue;
            if(stop_requested)break;
            perror("accept");failure=1;break;
        }
        if(stop_requested){close(fd);break;} pthread_mutex_lock(&c->lock); if(c->active>=MAX_CONNECTIONS){pthread_mutex_unlock(&c->lock);error(fd,503,"Connection limit reached");close(fd);continue;} c->active++;c->total++;pthread_mutex_unlock(&c->lock);
        client *cl=malloc(sizeof *cl); pthread_t t; if(!cl){close(fd);pthread_mutex_lock(&c->lock);c->active--;pthread_mutex_unlock(&c->lock);continue;} cl->fd=fd;cl->cfg=c; if(pthread_create(&t,NULL,worker,cl)){free(cl);close(fd);pthread_mutex_lock(&c->lock);c->active--;pthread_mutex_unlock(&c->lock);} else pthread_detach(t);
    }
    close(sock);
    /* No accepted connection is abandoned during normal SIGINT/SIGTERM stop.
     * curl transfers respect their configured total timeout, so wait is bounded
     * by existing active requests rather than abandoning them mid-write. */
    pthread_mutex_lock(&c->lock);
    while(c->active)pthread_cond_wait(&c->drained,&c->lock);
    pthread_mutex_unlock(&c->lock);
    return failure?-1:0;
}
