#include "yag.h"
#include "yyjson.h"
#include <curl/curl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_ADMIN_JSON (2*1024*1024)
typedef struct {
    char *bytes;
    size_t count;
    int oversized;
} output_buffer;
typedef struct {
    yag_config *cfg;
    char model[256];
} pull_job;

static int valid_model(const char *s,size_t n) {
    if(!s || n<1 || n>254 || strlen(s)!=n)return 0;
    for(size_t i=0;i<n;i++) {
        char c=s[i];
        if(!((c>='A'&&c<='Z') || (c>='a'&&c<='z')
            || (c>='0'&&c<='9') || c=='.' || c=='-' || c=='_'
            || c=='/' || c==':'))return 0;
    }
    return (s[0]>='A'&&s[0]<='Z')
        || (s[0]>='a'&&s[0]<='z')
        || (s[0]>='0'&&s[0]<='9');
}
static size_t append(char *input,size_t width,size_t count,void *context) {
    output_buffer *out=context;
    size_t bytes=width*count;
    if(bytes>MAX_ADMIN_JSON || out->count>MAX_ADMIN_JSON-bytes) {
        out->oversized=1;return 0;
    }
    char *next=realloc(out->bytes,out->count+bytes+1);
    if(!next)return 0;
    out->bytes=next;
    memcpy(out->bytes+out->count,input,bytes);
    out->count+=bytes;
    out->bytes[out->count]=0;
    return bytes;
}
static int pull_cancelled(void *context,curl_off_t total,curl_off_t now,
                          curl_off_t up_total,curl_off_t up_now) {
    (void)total;(void)now;(void)up_total;(void)up_now;
    yag_config *cfg=context;
    pthread_mutex_lock(&cfg->lock);
    int stopping=cfg->ollama_job_shutdown!=0;
    pthread_mutex_unlock(&cfg->lock);
    return stopping;
}
static int call_ollama(const yag_config *cfg,const char *path,
       const char *method,const char *body,long timeout,output_buffer *out,
       long *http_status,int cancellable) {
    CURL *curl=curl_easy_init();
    if(!curl)return -1;
    size_t bytes=strlen(cfg->ollama_admin_url)+strlen(path)+1;
    char *url=malloc(bytes);
    struct curl_slist *headers=NULL;
    if(!url){curl_easy_cleanup(curl);return -1;}
    snprintf(url,bytes,"%s%s",cfg->ollama_admin_url,path);
    headers=curl_slist_append(headers,"Content-Type: application/json");
    int rc=-1;
    if(headers) {
        curl_easy_setopt(curl,CURLOPT_URL,url);
        curl_easy_setopt(curl,CURLOPT_HTTPHEADER,headers);
        curl_easy_setopt(curl,CURLOPT_PROTOCOLS,CURLPROTO_HTTP|CURLPROTO_HTTPS);
        curl_easy_setopt(curl,CURLOPT_FOLLOWLOCATION,0L);
        curl_easy_setopt(curl,CURLOPT_CONNECTTIMEOUT,5L);
        curl_easy_setopt(curl,CURLOPT_TIMEOUT,timeout);
        curl_easy_setopt(curl,CURLOPT_NOSIGNAL,1L);
        curl_easy_setopt(curl,CURLOPT_WRITEFUNCTION,append);
        curl_easy_setopt(curl,CURLOPT_WRITEDATA,out);
        if(body) {
            curl_easy_setopt(curl,CURLOPT_POST,1L);
            curl_easy_setopt(curl,CURLOPT_POSTFIELDS,body);
            curl_easy_setopt(curl,CURLOPT_POSTFIELDSIZE,(long)strlen(body));
        }
        if(strcmp(method,"POST") && strcmp(method,"GET"))
            curl_easy_setopt(curl,CURLOPT_CUSTOMREQUEST,method);
        if(cancellable) {
            curl_easy_setopt(curl,CURLOPT_NOPROGRESS,0L);
            curl_easy_setopt(curl,CURLOPT_XFERINFOFUNCTION,pull_cancelled);
            curl_easy_setopt(curl,CURLOPT_XFERINFODATA,(void *)cfg);
        }
        rc=(int)curl_easy_perform(curl);
        curl_easy_getinfo(curl,CURLINFO_RESPONSE_CODE,http_status);
    }
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    free(url);
    return rc;
}
static void failure(int fd,int status,const char *message) {
    char body[300];
    snprintf(body,sizeof body,"{\"error\":{\"message\":\"%s\"}}",message);
    reply(fd,status,"application/json",body);
}
static void *pull_worker(void *context) {
    pull_job *job=context;
    yag_config *cfg=job->cfg;
    char request[320];
    snprintf(request,sizeof request,
        "{\"name\":\"%s\",\"stream\":false}",job->model);
    output_buffer result={0};
    long status=0;
    int rc=call_ollama(cfg,"/api/pull","POST",request,3600,
                       &result,&status,1);
    int success=rc==CURLE_OK && status>=200 && status<300;
    if(success) {
        yyjson_doc *d=yyjson_read(result.bytes,result.count,0);
        yyjson_val *root=d?yyjson_doc_get_root(d):NULL;
        yyjson_val *error=yyjson_obj_get(root,"error");
        yyjson_val *state=yyjson_obj_get(root,"status");
        if(!yyjson_is_obj(root) || error
           || (state && !yyjson_equals_str(state,"success")))success=0;
        yyjson_doc_free(d);
    }
    free(result.bytes);
    pthread_mutex_lock(&cfg->lock);
    cfg->ollama_job_http_status=status;
    cfg->ollama_job_state=success?2:3;
    cfg->ollama_job_running=0;
    pthread_cond_broadcast(&cfg->ollama_job_done);
    pthread_mutex_unlock(&cfg->lock);
    free(job);
    return NULL;
}
static int start_pull(int fd,yag_config *cfg,const char *model) {
    pull_job *job=calloc(1,sizeof *job);
    if(!job){failure(fd,500,"Out of memory");return 1;}
    job->cfg=cfg;
    snprintf(job->model,sizeof job->model,"%s",model);
    pthread_mutex_lock(&cfg->lock);
    if(cfg->ollama_job_running) {
        pthread_mutex_unlock(&cfg->lock);
        free(job);
        failure(fd,409,"A model download is already running");
        return 1;
    }
    cfg->ollama_job_running=1;
    cfg->ollama_job_state=1;
    cfg->ollama_job_http_status=0;
    cfg->ollama_job_sequence++;
    snprintf(cfg->ollama_job_model,sizeof cfg->ollama_job_model,"%s",model);
    pthread_t thread;
    int failed=pthread_create(&thread,NULL,pull_worker,job);
    if(failed) {
        cfg->ollama_job_running=0;
        cfg->ollama_job_state=3;
        pthread_cond_broadcast(&cfg->ollama_job_done);
    } else pthread_detach(thread);
    unsigned long sequence=cfg->ollama_job_sequence;
    pthread_mutex_unlock(&cfg->lock);
    if(failed){free(job);failure(fd,503,"Model download worker unavailable");return 1;}
    char json[160];
    snprintf(json,sizeof json,
        "{\"status\":\"running\",\"job_id\":%lu}",sequence);
    reply(fd,202,"application/json",json);
    return 1;
}
static int show_job(int fd,yag_config *cfg) {
    pthread_mutex_lock(&cfg->lock);
    int state=(int)cfg->ollama_job_state;
    char name[256];
    snprintf(name,sizeof name,"%s",cfg->ollama_job_model);
    unsigned long id=cfg->ollama_job_sequence;
    long http=cfg->ollama_job_http_status;
    pthread_mutex_unlock(&cfg->lock);
    char out[512];
    snprintf(out,sizeof out,
        "{\"object\":\"gateway.ollama_job\",\"job_id\":%lu,"
        "\"status\":\"%s\",\"model\":\"%s\",\"upstream_http_status\":%ld}",
        id,state==1?"running":state==2?"completed":
        state==3?"failed":"idle",name,http);
    reply(fd,200,"application/json",out);
    return 1;
}
int ollama_admin_handle(int fd,yag_config *cfg,const char *method,
                        const char *uri,const char *body,size_t length) {
    if(strncmp(uri,"/api/admin/ollama/",18))return 0;
    if(strcmp(uri,"/api/admin/ollama/models")
        && strcmp(uri,"/api/admin/ollama/loaded")
        && strcmp(uri,"/api/admin/ollama/pull")
        && strcmp(uri,"/api/admin/ollama/jobs")
        && strcmp(uri,"/api/admin/ollama/delete"))return 0;
    if(!cfg->ollama_admin_url || !*cfg->ollama_admin_url) {
        failure(fd,503,"Ollama administration is not configured");
        return 1;
    }
    if(!strcmp(uri,"/api/admin/ollama/jobs") && !strcmp(method,"GET"))
        return show_job(fd,cfg);
    if(!strcmp(method,"GET") && (!strcmp(uri,"/api/admin/ollama/models")
        || !strcmp(uri,"/api/admin/ollama/loaded"))) {
        output_buffer out={0};
        long status=0;
        int rc=call_ollama(cfg,
            !strcmp(uri,"/api/admin/ollama/models")?"/api/tags":"/api/ps",
            "GET",NULL,10,&out,&status,0);
        if(rc!=CURLE_OK || status<200 || status>=300 || out.oversized) {
            failure(fd,502,"Ollama model inventory unavailable");
        } else {
            yyjson_doc *doc=yyjson_read(out.bytes,out.count,0);
            if(doc && yyjson_is_obj(yyjson_doc_get_root(doc)))
                reply(fd,200,"application/json",out.bytes);
            else failure(fd,502,"Ollama returned invalid model inventory");
            yyjson_doc_free(doc);
        }
        free(out.bytes);
        return 1;
    }
    if(strcmp(method,"POST") || (!strstr(uri,"/pull") && !strstr(uri,"/delete"))) {
        failure(fd,405,"Unsupported Ollama administration method");
        return 1;
    }
    yyjson_doc *d=yyjson_read(body,length,0);
    yyjson_val *root=d?yyjson_doc_get_root(d):NULL;
    yyjson_val *name=yyjson_obj_get(root,"name");
    if(!yyjson_is_obj(root) || yyjson_obj_size(root)!=1
        || !yyjson_is_str(name)
        || !valid_model(yyjson_get_str(name),yyjson_get_len(name))) {
        yyjson_doc_free(d);
        failure(fd,400,"Expected valid Ollama model name");
        return 1;
    }
    if(!strcmp(uri,"/api/admin/ollama/pull")) {
        start_pull(fd,cfg,yyjson_get_str(name));
    } else {
        pthread_mutex_lock(&cfg->lock);
        int busy=cfg->ollama_job_running!=0;
        pthread_mutex_unlock(&cfg->lock);
        if(busy)failure(fd,409,"Cannot delete while a model download is running");
        else {
            char request[320];
            snprintf(request,sizeof request,
                "{\"name\":\"%s\"}",yyjson_get_str(name));
            output_buffer out={0};
            long status=0;
            int rc=call_ollama(cfg,"/api/delete","DELETE",request,20,
                               &out,&status,0);
            if(rc!=CURLE_OK)failure(fd,502,"Model deletion backend unavailable");
            else if(status>=200 && status<300)
                reply(fd,200,"application/json","{\"ok\":true}");
            else if(status==404)failure(fd,404,"Ollama model not found");
            else failure(fd,502,"Ollama model deletion failed");
            free(out.bytes);
        }
    }
    yyjson_doc_free(d);
    return 1;
}
