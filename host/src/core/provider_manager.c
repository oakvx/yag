#include "yag.h"
#include "yyjson.h"
#include <arpa/inet.h>
#include <curl/curl.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define PROVIDER_STORE_MAX 32768
#define MODEL_PROBE_MAX 131072

static void fail(int fd,int status,const char *reason) {
    char json[256];
    snprintf(json,sizeof json,"{\"error\":{\"message\":\"%s\"}}",reason);
    reply(fd,status,"application/json",json);
}
void provider_pool_free(yag_pool_backend pool[8],size_t count) {
    for(size_t i=0;i<count && i<8;i++) {
        free(pool[i].url);
        free(pool[i].key_env);
        for(size_t j=0;j<pool[i].model_count;j++)free(pool[i].models[j]);
        memset(&pool[i],0,sizeof pool[i]);
    }
}
static int plain_id(const char *s,size_t n) {
    if(!s || !n || n>254 || strlen(s)!=n)return 0;
    for(size_t i=0;i<n;i++) {
        unsigned char c=(unsigned char)s[i];
        if(!((c>='A'&&c<='Z') || (c>='a'&&c<='z') ||
             (c>='0'&&c<='9') || c=='-' || c=='_' ||
             c=='.' || c==':' || c=='/'))return 0;
    }
    return 1;
}
/* For HTTP only private-network literals and local DNS labels are accepted.
 * HTTPS may reach remote providers; API credentials are environment references,
 * never supplied in dashboard JSON. No URL userinfo, query or fragments. */
static int safe_url(const char *url) {
    if(!url)return 0;
    size_t len=strlen(url);
    if(len<12 || len>512)return 0;
    for(size_t i=0;i<len;i++)if((unsigned char)url[i]<33 ||
        (unsigned char)url[i]>126)return 0;
    int tls=!strncmp(url,"https://",8);
    if(!tls && strncmp(url,"http://",7))return 0;
    const char *host=url+(tls?8:7),*slash=strchr(host,'/');
    if(!slash || strcmp(slash,"/v1"))return 0;
    size_t n=(size_t)(slash-host);
    if(n==0 || n>253 || memchr(host,'@',n) || memchr(host,'[',n)
       || memchr(host,']',n))return 0;
    char hostname[254];
    memcpy(hostname,host,n);hostname[n]=0;
    char *port=strchr(hostname,':');
    if(port) {
        *port++=0;
        if(!*port)return 0;
        unsigned value=0;
        for(char *p=port;*p;p++) {
            if(*p<'0'||*p>'9')return 0;
            value=value*10u+(unsigned)(*p-'0');
            if(value>65535)return 0;
        }
        if(!value)return 0;
    }
    size_t hostlen=strlen(hostname);
    if(!hostlen || hostname[0]=='-' || hostname[hostlen-1]=='-' ||
        hostname[hostlen-1]=='.')return 0;
    for(size_t i=0;i<hostlen;i++) {
        char ch=hostname[i];
        if(!((ch>='a'&&ch<='z') || (ch>='A'&&ch<='Z') ||
             (ch>='0'&&ch<='9') || ch=='.' || ch=='-'))return 0;
        if(ch=='.' && (i==0 || hostname[i-1]=='.'))return 0;
    }
    if(tls)return 1;
    struct in_addr ip;
    if(inet_pton(AF_INET,hostname,&ip)==1) {
        unsigned v=ntohl(ip.s_addr);
        return (v>>24)==10 || (v>>24)==127 ||
               (v>>20)==0xac1 || (v>>16)==0xc0a8;
    }
    /* Reject numeric but non-canonical IPv4 encodings (e.g. integer hosts).
     * Otherwise some DNS/URL parsers can interpret public IPv4 addresses. */
    int has_letter=0;
    for(size_t i=0;i<hostlen;i++)
        if((hostname[i]>='a'&&hostname[i]<='z') ||
           (hostname[i]>='A'&&hostname[i]<='Z'))has_letter=1;
    if(!has_letter)return 0;
    /* A DNS name with an external/public suffix is not allowed over HTTP. */
    const char *dot=strchr(hostname,'.');
    if(!dot)return 1;
    return hostlen>6 && !strcmp(hostname+hostlen-6,".local");
}
static int private_key_reference(const char *name) {
    if(!name || strlen(name)!=14 ||
       strncmp(name,"YAG_POOL_KEY_",13) || name[13]<'1' || name[13]>'8')
        return 0;
    const char *key=getenv(name);
    return key && *key && !strpbrk(key,"\r\n");
}
static int parse_replicas(const char *json,size_t length,
                          const yag_config *cfg,yag_pool_backend pool[8],
                          size_t *count) {
    *count=0;
    if(!json || length>PROVIDER_STORE_MAX || memchr(json,0,length))return 0;
    yyjson_doc *doc=yyjson_read(json,length,0);
    yyjson_val *root=doc?yyjson_doc_get_root(doc):NULL;
    yyjson_val *list=yyjson_obj_get(root,"replicas");
    int good=yyjson_is_obj(root) && yyjson_obj_size(root)==1
        && yyjson_is_arr(list) && yyjson_arr_size(list)<=8;
    if(good)for(size_t i=0;i<yyjson_arr_size(list);i++) {
        yyjson_val *item=yyjson_arr_get(list,i);
        yyjson_val *url=yyjson_obj_get(item,"url");
        yyjson_val *models=yyjson_obj_get(item,"models");
        yyjson_val *key=yyjson_obj_get(item,"key_env");
        yyjson_val *enabled=yyjson_obj_get(item,"enabled");
        yyjson_val *priority=yyjson_obj_get(item,"priority");
        if(!yyjson_is_obj(item) || !yyjson_is_str(url) ||
            strlen(yyjson_get_str(url))!=yyjson_get_len(url) ||
            !safe_url(yyjson_get_str(url)) ||
            !strcmp(yyjson_get_str(url),cfg->upstream) ||
            yyjson_obj_size(item)!=(size_t)(1+(models?1:0)+(key?1:0)
                                          +(enabled?1:0)+(priority?1:0)) ||
            (models && (!yyjson_is_arr(models) ||
                yyjson_arr_size(models)>32)) ||
            (key && (!yyjson_is_str(key) ||
                yyjson_get_len(key)!=strlen(yyjson_get_str(key)) ||
                !private_key_reference(yyjson_get_str(key)))) ||
            (enabled && !yyjson_is_bool(enabled)) ||
            (priority && (!yyjson_is_uint(priority) ||
                yyjson_get_uint(priority)>100))) {
            good=0;break;
        }
        for(size_t j=0;j<*count;j++)
            if(!strcmp(pool[j].url,yyjson_get_str(url)))good=0;
        if(!good)break;
        yag_pool_backend *p=&pool[*count];
        p->url=strdup(yyjson_get_str(url));
        if(!p->url){good=0;break;}
        (*count)++;
        p->enabled=enabled?yyjson_get_bool(enabled):1;
        p->priority=priority?(unsigned)yyjson_get_uint(priority):50;
        if(key) {
            p->key_env=strdup(yyjson_get_str(key));
            if(!p->key_env){good=0;break;}
            p->key=getenv(p->key_env);
        } else p->key="";
        if(models)for(size_t j=0;j<yyjson_arr_size(models);j++) {
            yyjson_val *m=yyjson_arr_get(models,j);
            if(!yyjson_is_str(m) ||
                !plain_id(yyjson_get_str(m),yyjson_get_len(m))) {
                good=0;break;
            }
            for(size_t k=0;k<p->model_count;k++)
                if(!strcmp(p->models[k],yyjson_get_str(m)))good=0;
            if(!good)break;
            p->models[p->model_count]=strdup(yyjson_get_str(m));
            if(!p->models[p->model_count]){good=0;break;}
            p->model_count++;
        }
        if(!good)break;
    }
    yyjson_doc_free(doc);
    if(!good)provider_pool_free(pool,*count);
    if(!good)*count=0;
    return good;
}
static int secure_store_path(const char *path) {
    if(!path || path[0]!='/' || strlen(path)>1024 ||
        strpbrk(path,"\r\n") || !strcmp(path,"/"))return 0;
    const char *slash=strrchr(path,'/');
    if(!slash || !slash[1] || !strcmp(slash+1,".") ||
       !strcmp(slash+1,".."))return 0;
    /* The directory must be private and owned by the gateway process. */
    char directory[1025];
    size_t n=(size_t)(slash-path);
    if(n==0)n=1;
    memcpy(directory,path,n);directory[n]=0;
    struct stat st;
    if(lstat(directory,&st) || !S_ISDIR(st.st_mode) ||
       st.st_uid!=geteuid() || (st.st_mode&0022))return 0;
    return 1;
}
static int existing_store_safe(const char *path) {
    struct stat st;
    if(lstat(path,&st))return errno==ENOENT;
    return S_ISREG(st.st_mode) && st.st_uid==geteuid() &&
        st.st_nlink==1 && !(st.st_mode&0077);
}
static int read_store(const char *path,char **bytes,size_t *len) {
    *bytes=NULL;*len=0;
    if(!existing_store_safe(path))return -1;
    int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);
    if(fd<0)return errno==ENOENT?0:-1;
    struct stat st;
    if(fstat(fd,&st) || !S_ISREG(st.st_mode) || st.st_uid!=geteuid() ||
       st.st_nlink!=1 || (st.st_mode&0077) ||
       st.st_size<0 || st.st_size>PROVIDER_STORE_MAX) {
        close(fd);return -1;
    }
    char *buf=calloc(PROVIDER_STORE_MAX+1,1);
    if(!buf){close(fd);return -1;}
    ssize_t size=read(fd,buf,PROVIDER_STORE_MAX+1);
    close(fd);
    if(size<0 || size>PROVIDER_STORE_MAX){free(buf);return -1;}
    if(!size){free(buf);return -1;}
    *bytes=buf;*len=(size_t)size;
    return 1;
}
static char *serialize_pool(const yag_pool_backend pool[8],size_t count) {
    yyjson_mut_doc *doc=yyjson_mut_doc_new(NULL);
    if(!doc)return NULL;
    yyjson_mut_val *root=yyjson_mut_obj(doc);
    yyjson_mut_val *arr=root?yyjson_mut_obj_add_arr(doc,root,"replicas"):NULL;
    int good=arr!=NULL;
    for(size_t i=0;good && i<count;i++) {
        const yag_pool_backend *p=&pool[i];
        yyjson_mut_val *o=yyjson_mut_obj(doc);
        yyjson_mut_val *models=o?yyjson_mut_obj_add_arr(doc,o,"models"):NULL;
        good=models && yyjson_mut_obj_add_str(doc,o,"url",p->url)
            && yyjson_mut_obj_add_bool(doc,o,"enabled",p->enabled!=0)
            && yyjson_mut_obj_add_uint(doc,o,"priority",p->priority);
        if(good && p->key_env)
            good=yyjson_mut_obj_add_str(doc,o,"key_env",p->key_env);
        for(size_t j=0;good && j<p->model_count;j++)
            good=yyjson_mut_arr_add_str(doc,models,p->models[j]);
        if(good)good=yyjson_mut_arr_add_val(arr,o);
    }
    if(good)yyjson_mut_doc_set_root(doc,root);
    char *result=good?yyjson_mut_write(doc,0,NULL):NULL;
    yyjson_mut_doc_free(doc);
    return result;
}
static int write_store(const char *path,const char *json) {
    if(!secure_store_path(path) || !existing_store_safe(path))return 0;
    char temp[1100];
    if(snprintf(temp,sizeof temp,"%s.XXXXXX",path)>=(int)sizeof temp)return 0;
    int fd=mkstemp(temp);
    if(fd<0)return 0;
    int ok=!fchmod(fd,0600);
    size_t len=strlen(json),off=0;
    while(ok && off<len) {
        ssize_t n=write(fd,json+off,len-off);
        if(n<0 && errno==EINTR)continue;
        if(n<=0){ok=0;break;}
        off+=(size_t)n;
    }
    if(ok)ok=!fsync(fd);
    if(close(fd))ok=0;
    if(ok && !existing_store_safe(path))ok=0;
    if(ok)ok=!rename(temp,path);
    if(!ok)unlink(temp);
    return ok;
}
int provider_manager_load(yag_config *cfg) {
    const char *path=cfg->provider_store;
    if(!path || !*path)return 0;
    if(!secure_store_path(path)) {
        fputs("YAG_PROVIDER_STORE must use a private owned directory\n",stderr);
        return -1;
    }
    char *raw=NULL;size_t len=0;
    int read_result=read_store(path,&raw,&len);
    if(read_result<0) {
        fputs("YAG_PROVIDER_STORE is unreadable or insecure\n",stderr);
        return -1;
    }
    if(!read_result)return 0; /* initial boot: retain YAG_UPSTREAM_POOL */
    yag_pool_backend candidate[8]={0};
    size_t count=0;
    int valid=parse_replicas(raw,len,cfg,candidate,&count);
    free(raw);
    if(!valid) {
        fputs("YAG_PROVIDER_STORE has an invalid provider configuration\n",stderr);
        return -1;
    }
    provider_pool_free(cfg->pool,cfg->pool_count);
    memcpy(cfg->pool,candidate,sizeof candidate);
    cfg->pool_count=count;
    return 0;
}
static void list_providers(int fd,yag_config *cfg) {
    yyjson_mut_doc *doc=yyjson_mut_doc_new(NULL);
    if(!doc){fail(fd,500,"Out of memory");return;}
    yyjson_mut_val *root=yyjson_mut_obj(doc);
    yyjson_mut_val *arr=root?yyjson_mut_obj_add_arr(doc,root,"data"):NULL;
    int good=arr && yyjson_mut_obj_add_bool(doc,root,"editable",
                        cfg->provider_store && *cfg->provider_store);
    pthread_mutex_lock(&cfg->lock);
    for(size_t i=0;good && i<cfg->pool_count;i++) {
        yag_pool_backend *p=&cfg->pool[i];
        yyjson_mut_val *o=yyjson_mut_obj(doc);
        yyjson_mut_val *models=o?yyjson_mut_obj_add_arr(doc,o,"models"):NULL;
        good=models && yyjson_mut_obj_add_uint(doc,o,"index",i+1)
            && yyjson_mut_obj_add_str(doc,o,"url",p->url)
            && yyjson_mut_obj_add_str(doc,o,"key_env",
                                      p->key_env?p->key_env:"")
            && yyjson_mut_obj_add_bool(doc,o,"enabled",p->enabled)
            && yyjson_mut_obj_add_uint(doc,o,"priority",p->priority);
        for(size_t j=0;good && j<p->model_count;j++)
            good=yyjson_mut_arr_add_str(doc,models,p->models[j]);
        if(good)good=yyjson_mut_arr_add_val(arr,o);
    }
    pthread_mutex_unlock(&cfg->lock);
    if(good)yyjson_mut_doc_set_root(doc,root);
    char *out=good?yyjson_mut_write(doc,0,NULL):NULL;
    if(out)reply(fd,200,"application/json",out);
    else fail(fd,500,"Cannot serialize provider configuration");
    free(out);yyjson_mut_doc_free(doc);
}
static void apply_providers(int fd,yag_config *cfg,const char *body,size_t len) {
    if(!cfg->provider_store || !*cfg->provider_store) {
        fail(fd,503,"Enable YAG_PROVIDER_STORE for provider editing");return;
    }
    yag_pool_backend candidate[8]={0};
    size_t count=0;
    if(!parse_replicas(body,len,cfg,candidate,&count)) {
        fail(fd,400,"Invalid provider configuration");return;
    }
    char *json=serialize_pool(candidate,count);
    if(!json){provider_pool_free(candidate,count);fail(fd,500,"Out of memory");return;}
    if(strlen(json)>PROVIDER_STORE_MAX) {
        provider_pool_free(candidate,count);free(json);
        fail(fd,413,"Provider configuration exceeds persistent store limit");return;
    }
    pthread_mutex_lock(&cfg->lock);
    int busy=cfg->default_pool_active!=0;
    for(size_t i=0;i<cfg->pool_count;i++)if(cfg->pool[i].active)busy=1;
    int persisted=0;
    if(!busy)persisted=write_store(cfg->provider_store,json);
    if(!busy && persisted) {
        provider_pool_free(cfg->pool,cfg->pool_count);
        memcpy(cfg->pool,candidate,sizeof candidate);
        cfg->pool_count=count;
        cfg->pool_cursor=0;
    }
    pthread_mutex_unlock(&cfg->lock);
    if(busy)provider_pool_free(candidate,count);
    if(!busy && !persisted)provider_pool_free(candidate,count);
    free(json);
    if(busy)fail(fd,409,"Inference in progress; retry after requests finish");
    else if(!persisted)fail(fd,500,"Could not persist provider configuration");
    else reply(fd,200,"application/json",
           "{\"status\":\"applied\",\"persisted\":true,\"restart_required\":false}");
}
typedef struct {char data[MODEL_PROBE_MAX+1];size_t length;} model_capture;
static size_t capture_model(char *data,size_t size,size_t nmemb,void *ctx) {
    model_capture *buf=ctx;
    if(size && nmemb>MODEL_PROBE_MAX/size)return 0;
    size_t n=size*nmemb;
    if(n>MODEL_PROBE_MAX-buf->length)return 0;
    memcpy(buf->data+buf->length,data,n);
    buf->length+=n;buf->data[buf->length]=0;
    return n;
}
static void probe_provider(int fd,yag_config *cfg,const char *body,size_t len) {
    yyjson_doc *input=yyjson_read(body,len,0);
    yyjson_val *root=input?yyjson_doc_get_root(input):NULL;
    yyjson_val *index=yyjson_obj_get(root,"index");
    if(!yyjson_is_obj(root) || yyjson_obj_size(root)!=1 ||
       !yyjson_is_uint(index) || yyjson_get_uint(index)>8) {
        yyjson_doc_free(input);fail(fd,400,"Invalid provider index");return;
    }
    size_t slot=(size_t)yyjson_get_uint(index);
    yyjson_doc_free(input);
    char *url=NULL,*key=NULL;
    pthread_mutex_lock(&cfg->lock);
    if(slot<=cfg->pool_count) {
        const char *u=slot?cfg->pool[slot-1].url:cfg->upstream;
        const char *k=slot?cfg->pool[slot-1].key:cfg->upstream_key;
        url=strdup(u);
        key=strdup(k?k:"");
    }
    pthread_mutex_unlock(&cfg->lock);
    if(!url || !key){free(url);free(key);fail(fd,400,"Unknown provider index");return;}
    size_t n=strlen(url)+strlen("/models")+1;
    char *endpoint=malloc(n);
    if(!endpoint){free(url);free(key);fail(fd,500,"Out of memory");return;}
    snprintf(endpoint,n,"%s/models",url);
    CURL *curl=curl_easy_init();
    model_capture *out=calloc(1,sizeof *out);
    struct curl_slist *headers=NULL;
    char *auth=NULL;
    long http=0;double elapsed=0;
    CURLcode result=CURLE_FAILED_INIT;
    if(curl && out) {
        if(*key) {
            auth=malloc(strlen(key)+23);
            if(auth) {
                sprintf(auth,"Authorization: Bearer %s",key);
                headers=curl_slist_append(headers,auth);
            }
        }
        if(!*key || (auth && headers)) {
            curl_easy_setopt(curl,CURLOPT_URL,endpoint);
            curl_easy_setopt(curl,CURLOPT_HTTPHEADER,headers);
            curl_easy_setopt(curl,CURLOPT_FOLLOWLOCATION,0L);
            curl_easy_setopt(curl,CURLOPT_PROTOCOLS,CURLPROTO_HTTP|CURLPROTO_HTTPS);
            curl_easy_setopt(curl,CURLOPT_PROXY,"");
            curl_easy_setopt(curl,CURLOPT_NOSIGNAL,1L);
            curl_easy_setopt(curl,CURLOPT_CONNECTTIMEOUT_MS,1200L);
            curl_easy_setopt(curl,CURLOPT_TIMEOUT_MS,3000L);
            curl_easy_setopt(curl,CURLOPT_WRITEFUNCTION,capture_model);
            curl_easy_setopt(curl,CURLOPT_WRITEDATA,out);
            result=curl_easy_perform(curl);
            curl_easy_getinfo(curl,CURLINFO_RESPONSE_CODE,&http);
            curl_easy_getinfo(curl,CURLINFO_TOTAL_TIME,&elapsed);
        }
    }
    if(auth){volatile char *p=auth;for(size_t i=0;i<strlen(auth);i++)p[i]=0;}
    free(auth);
    if(key){volatile char *p=key;for(size_t i=0;i<strlen(key);i++)p[i]=0;}
    free(key);free(url);free(endpoint);
    curl_slist_free_all(headers);
    if(curl)curl_easy_cleanup(curl);
    yyjson_doc *remote=out && result==CURLE_OK && http==200?
        yyjson_read(out->data,out->length,0):NULL;
    yyjson_val *data=remote?yyjson_obj_get(yyjson_doc_get_root(remote),"data"):NULL;
    int available=yyjson_is_arr(data);
    yyjson_mut_doc *doc=yyjson_mut_doc_new(NULL);
    yyjson_mut_val *response=doc?yyjson_mut_obj(doc):NULL;
    yyjson_mut_val *models=response?yyjson_mut_obj_add_arr(doc,response,"models"):NULL;
    int good=models && yyjson_mut_obj_add_bool(doc,response,"available",available)
        && yyjson_mut_obj_add_sint(doc,response,"http_status",http)
        && yyjson_mut_obj_add_uint(doc,response,"latency_ms",
                                    (unsigned long long)(elapsed*1000.0))
        && yyjson_mut_obj_add_sint(doc,response,"checked_at",(long long)time(NULL));
    if(good && available)for(size_t i=0;i<yyjson_arr_size(data) && i<32;i++) {
        yyjson_val *id=yyjson_obj_get(yyjson_arr_get(data,i),"id");
        if(yyjson_is_str(id) && plain_id(yyjson_get_str(id),yyjson_get_len(id)))
            good=yyjson_mut_arr_add_str(doc,models,yyjson_get_str(id));
        if(!good)break;
    }
    if(good)yyjson_mut_doc_set_root(doc,response);
    char *serialized=good?yyjson_mut_write(doc,0,NULL):NULL;
    if(serialized)reply(fd,200,"application/json",serialized);
    else fail(fd,500,"Could not serialize probe results");
    free(serialized);yyjson_mut_doc_free(doc);yyjson_doc_free(remote);free(out);
}
int provider_manager_handle(int fd,yag_config *cfg,const char *method,
                            const char *uri,const char *body,size_t len) {
    if(!strcmp(uri,"/api/admin/providers") && !strcmp(method,"GET")) {
        list_providers(fd,cfg);return 1;
    }
    if(!strcmp(uri,"/api/admin/providers/apply") && !strcmp(method,"POST")) {
        apply_providers(fd,cfg,body,len);return 1;
    }
    if(!strcmp(uri,"/api/admin/providers/check") && !strcmp(method,"POST")) {
        probe_provider(fd,cfg,body,len);return 1;
    }
    return 0;
}
