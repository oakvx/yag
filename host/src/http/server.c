#include "yag.h"
#include "yyjson.h"
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/time.h>
#include <netdb.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <errno.h>
#define MAX_HEADER 16384
#define MAX_BODY (1024*1024)
#define MAX_CONNECTIONS 32

typedef struct { int fd; yag_config *cfg; } client;
int send_all(int fd,const void *data,size_t len) { const char *p=data; while(len){ ssize_t n=send(fd,p,len,0); if(n<0 && errno==EINTR) continue; if(n<=0) return -1; p+=n; len-=(size_t)n; } return 0; }
void reply(int fd,int status,const char *type,const char *body) {
    char h[512]; size_t len=strlen(body); int n=snprintf(h,sizeof h,"HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",status,status==200?"OK":"Error",type,len);
    if(n>0 && (size_t)n<sizeof h && !send_all(fd,h,(size_t)n)) send_all(fd,body,len);
}
static void error(int fd,int status,const char *msg) { char b[512]; snprintf(b,sizeof b,"{\"error\":{\"message\":\"%s\"}}",msg); reply(fd,status,"application/json",b); }
static int key_equal(const char *a,const char *b) { size_t na=strlen(a),nb=strlen(b),n=na>nb?na:nb; unsigned diff=(unsigned)(na^nb); for(size_t i=0;i<n;i++) diff|=(unsigned char)(i<na?a[i]:0)^(unsigned char)(i<nb?b[i]:0); return diff==0; }
static int authenticated_key(const yag_config *c,const char *authorization) {
    if(!authorization || strncmp(authorization,"Bearer ",7))return -1;
    const char *candidate=authorization+7;
    int match=key_equal(candidate,c->api_key)?0:-1;
    for(size_t i=0;i<c->extra_key_count;i++)
        if(key_equal(candidate,c->extra_keys[i]))match=(int)i+1;
    return match;
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
static void asset(int fd,const yag_config *c,const char *uri) {
    const char *rel=!strcmp(uri,"/")?"/index.html":uri;
    if(strstr(rel,"..") || strpbrk(rel,"%\\?") || strlen(rel)>512) { error(fd,404,"Not found"); return; }
    char path[2048]; int n=snprintf(path,sizeof path,"%s%s",c->assets,rel); if(n<0 || (size_t)n>=sizeof path) {error(fd,404,"Not found");return;}
    FILE *f=fopen(path,"rb"); if(!f) {error(fd,404,"Not found");return;}
    if(fseek(f,0,SEEK_END) || ftell(f)<0) {fclose(f);error(fd,500,"Asset read failed");return;}
    long len=ftell(f); rewind(f); if(len>10*1024*1024){fclose(f);error(fd,500,"Asset too large");return;}
    const char *type="application/octet-stream"; const char *ext=strrchr(rel,'.');
    if(ext && !strcmp(ext,".html"))type="text/html; charset=utf-8"; else if(ext && !strcmp(ext,".js"))type="text/javascript; charset=utf-8"; else if(ext && !strcmp(ext,".css"))type="text/css; charset=utf-8"; else if(ext && !strcmp(ext,".svg"))type="image/svg+xml";
    char h[512]; n=snprintf(h,sizeof h,"HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %ld\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'\r\nConnection: close\r\n\r\n",type,len);
    if(n>0 && (size_t)n<sizeof h && !send_all(fd,h,(size_t)n)) {char b[8192]; size_t got; while((got=fread(b,1,sizeof b,f))) if(send_all(fd,b,got)) break; } fclose(f);
}
static void handle(int fd,yag_config *c) {
    char *buf=malloc(MAX_HEADER+MAX_BODY+1); if(!buf){error(fd,500,"Out of memory");return;} size_t used=0,header_len=0;
    while(used<MAX_HEADER){ ssize_t n=recv(fd,buf+used,MAX_HEADER-used,0); if(n<=0) goto done; used+=(size_t)n; buf[used]=0; char *p=strstr(buf,"\r\n\r\n"); if(p){header_len=(size_t)(p-buf)+4;break;} }
    if(!header_len){error(fd,431,"Headers too large or invalid");goto done;}
    /* Reject NUL and malformed framing to avoid ambiguous request interpretation. */
    if(memchr(buf,0,header_len)){error(fd,400,"Invalid headers");goto done;}
    char *line_end=strstr(buf,"\r\n"); if(!line_end){error(fd,400,"Invalid request");goto done;} *line_end=0;
    char method[8],uri[1024],version[16],extra; if(sscanf(buf,"%7s %1023s %15s %c",method,uri,version,&extra)!=3 || (strcmp(version,"HTTP/1.1") && strcmp(version,"HTTP/1.0")) || uri[0]!='/'){error(fd,400,"Invalid request line");goto done;}
    size_t length=0; int have_length=0,have_auth=0,transfer_encoding=0; char *auth=NULL; char *line=line_end+2;
    while(line<buf+header_len-2) { char *end=strstr(line,"\r\n"); if(!end || end==line) break; *end=0; char *colon=strchr(line,':'); if(!colon || colon==line){error(fd,400,"Malformed header");goto done;} *colon=0; char *v=colon+1; while(*v==' '||*v=='\t')v++; char *tail=v+strlen(v); while(tail>v && (tail[-1]==' '||tail[-1]=='\t')) *--tail=0;
        if(!strcasecmp(line,"Content-Length")) { if(have_length++ || !*v){error(fd,400,"Invalid content length");goto done;} for(char *p=v;*p;p++) if(!isdigit((unsigned char)*p)){error(fd,400,"Invalid content length");goto done;} errno=0; unsigned long long x=strtoull(v,NULL,10); if(errno || x>MAX_BODY){error(fd,413,"Request too large");goto done;} length=(size_t)x; }
        else if(!strcasecmp(line,"Transfer-Encoding")) transfer_encoding=1;
        else if(!strcasecmp(line,"Authorization")) { if(have_auth++){error(fd,400,"Duplicate authorization");goto done;} auth=v; }
        line=end+2;
    }
    if(transfer_encoding){error(fd,400,"Transfer-Encoding is not supported");goto done;}
    if(!strcmp(method,"POST") && !have_length){error(fd,411,"Content-Length required");goto done;}
    while(used-header_len<length){ssize_t n=recv(fd,buf+used,length-(used-header_len),0);if(n<=0)goto done;used+=(size_t)n;}
    char *body=buf+header_len; body[length]=0;
    if(!strcmp(uri,"/health") && !strcmp(method,"GET")){reply(fd,200,"application/json","{\"status\":\"ok\"}");goto done;}
    int api=!strncmp(uri,"/v1/",4) || !strncmp(uri,"/api/",5);
    if(!api){ if(!strcmp(method,"GET"))asset(fd,c,uri);else error(fd,405,"Method not allowed");goto done; }
    int key_index=authenticated_key(c,auth);
    if(key_index<0){error(fd,401,"Invalid API key");goto done;}
    if(!rate_permit(c,key_index)){error(fd,429,"Rate limit exceeded");goto done;}
    if(!strcmp(uri,"/api/status") && !strcmp(method,"GET")) { char out[256]; pthread_mutex_lock(&c->lock); unsigned active=c->active; unsigned long total=c->total; pthread_mutex_unlock(&c->lock); snprintf(out,sizeof out,"{\"status\":\"ok\",\"uptime_seconds\":%ld,\"active_connections\":%u,\"total_connections\":%lu}",(long)(time(NULL)-c->started),active,total);reply(fd,200,"application/json",out); }
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
    else if(!strcmp(uri,"/v1/models") && !strcmp(method,"GET")) models_handle(fd,c);
    else if(!strcmp(uri,"/v1/chat/completions") && !strcmp(method,"POST")) {
        yyjson_doc *doc=yyjson_read(body,length,0); yyjson_val *root=doc?yyjson_doc_get_root(doc):NULL;
        if(!yyjson_is_obj(root) || !yyjson_is_str(yyjson_obj_get(root,"model")) || !yyjson_is_arr(yyjson_obj_get(root,"messages"))) error(fd,400,"Expected JSON object with model string and messages array");
        else upstream_request(fd,c,"/chat/completions",body,length,yyjson_get_str(yyjson_obj_get(root,"model")));
        yyjson_doc_free(doc);
    } else if(!strcmp(uri,"/v1/responses") && !strcmp(method,"POST")) responses_handle(fd,c,body,length);
    else if(!strcmp(uri,"/v1/messages") && !strcmp(method,"POST")) anthropic_messages_handle(fd,c,body,length);
    else if(!strcmp(uri,"/v1/messages/count_tokens")) error(fd,501,"Anthropic token counting not implemented");
    else if(!strcmp(uri,"/v1/messages")) error(fd,405,"Method not allowed");
    else error(fd,404,"Not found");
done: free(buf);
}
static void *worker(void *arg) { client *cl=arg; int fd=cl->fd; yag_config *c=cl->cfg; free(cl); struct timeval tv={.tv_sec=15}; setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&tv,sizeof tv); setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&tv,sizeof tv); handle(fd,c); close(fd); pthread_mutex_lock(&c->lock); c->active--; pthread_mutex_unlock(&c->lock); return NULL; }
int server_run(yag_config *c) {
    struct addrinfo hints={0},*res=NULL,*p; hints.ai_family=AF_UNSPEC; hints.ai_socktype=SOCK_STREAM; hints.ai_flags=AI_PASSIVE;
    int e=getaddrinfo(c->bind,c->port,&hints,&res); if(e){fprintf(stderr,"Listen address: %s\n",gai_strerror(e));return -1;}
    int sock=-1; for(p=res;p;p=p->ai_next){ sock=socket(p->ai_family,p->ai_socktype,p->ai_protocol);if(sock<0)continue; int yes=1; setsockopt(sock,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof yes); if(!bind(sock,p->ai_addr,p->ai_addrlen) && !listen(sock,64))break; close(sock);sock=-1; } freeaddrinfo(res); if(sock<0){perror("listen");return -1;}
    fprintf(stderr,"YAG listening on %s:%s\n",c->bind,c->port);
    for(;;){ int fd=accept(sock,NULL,NULL); if(fd<0){if(errno==EINTR)continue;perror("accept");break;} pthread_mutex_lock(&c->lock); if(c->active>=MAX_CONNECTIONS){pthread_mutex_unlock(&c->lock);error(fd,503,"Connection limit reached");close(fd);continue;} c->active++;c->total++;pthread_mutex_unlock(&c->lock);
        client *cl=malloc(sizeof *cl); pthread_t t; if(!cl){close(fd);pthread_mutex_lock(&c->lock);c->active--;pthread_mutex_unlock(&c->lock);continue;} cl->fd=fd;cl->cfg=c; if(pthread_create(&t,NULL,worker,cl)){free(cl);close(fd);pthread_mutex_lock(&c->lock);c->active--;pthread_mutex_unlock(&c->lock);} else pthread_detach(t);
    }
    close(sock); return -1;
}
