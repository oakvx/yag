#include "yag.h"
#include "yyjson.h"
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static size_t discard(void *context,long status,const char *type,const char *bytes,size_t len) {
    (void)context;(void)status;(void)type;(void)bytes;
    return len;
}
/* An HTTP 2xx /models response indicates reachability, not model capability. */
void provider_check_handle(int fd,const yag_config *cfg,const char *body,size_t len) {
    yyjson_doc *doc=yyjson_read(body,len,0);
    yyjson_val *root=doc?yyjson_doc_get_root(doc):NULL;
    yyjson_val *model=yyjson_obj_get(root,"model");
    if(!yyjson_is_obj(root) || yyjson_obj_size(root)!=(size_t)(model?1:0)
        || (model && (!yyjson_is_str(model) || !yyjson_get_len(model)
            || strlen(yyjson_get_str(model))!=yyjson_get_len(model)))) {
        reply(fd,400,"application/json","{\"error\":{\"message\":\"Expected optional nonempty model ID\"}}");
        yyjson_doc_free(doc);return;
    }
    const yag_config *target=cfg;
    const char *name=NULL;
    if(model) {
        name=yyjson_get_str(model);
        yag_config selected={0};
        int found=0;
        for(size_t i=0;i<cfg->route_count;i++) {
            if(strcmp(name,cfg->routes[i].model))continue;
            selected.upstream=cfg->routes[i].url;
            selected.upstream_key=cfg->routes[i].key;
            found=1;break;
        }
        if(!found) {
            reply(fd,404,"application/json","{\"error\":{\"message\":\"Configured model route not found\"}}");
            yyjson_doc_free(doc);return;
        }
        yag_config probe={0};
        probe.upstream=selected.upstream;
        probe.upstream_key=selected.upstream_key;
        probe.timeout=3;
        long status=0;
        int rc=upstream_perform(&probe,"/models",NULL,0,discard,NULL,&status,fd);
        yyjson_mut_doc *response=yyjson_mut_doc_new(NULL);
        if(!response){yyjson_doc_free(doc);reply(fd,500,"application/json","{\"error\":{\"message\":\"Out of memory\"}}");return;}
        yyjson_mut_val *result=yyjson_mut_obj(response);
        yyjson_mut_obj_add_bool(response,result,"reachable",rc==CURLE_OK && status>=200 && status<300);
        yyjson_mut_obj_add_strcpy(response,result,"model",name);
        yyjson_mut_obj_add_sint(response,result,"upstream_status",status);
        yyjson_mut_doc_set_root(response,result);
        char *json=yyjson_mut_write(response,0,NULL);
        if(json)reply(fd,200,"application/json",json);
        else reply(fd,500,"application/json","{\"error\":{\"message\":\"Serialization failed\"}}");
        free(json);yyjson_mut_doc_free(response);yyjson_doc_free(doc);return;
    }
    yag_config probe={0};
    probe.upstream=target->upstream;
    probe.upstream_key=target->upstream_key;
    probe.timeout=3;
    long status=0;
    int rc=upstream_perform(&probe,"/models",NULL,0,discard,NULL,&status,fd);
    yyjson_mut_doc *response=yyjson_mut_doc_new(NULL);
    if(!response){yyjson_doc_free(doc);reply(fd,500,"application/json","{\"error\":{\"message\":\"Out of memory\"}}");return;}
    yyjson_mut_val *result=yyjson_mut_obj(response);
    yyjson_mut_obj_add_bool(response,result,"reachable",rc==CURLE_OK && status>=200 && status<300);
    yyjson_mut_obj_add_null(response,result,"model");
    yyjson_mut_obj_add_sint(response,result,"upstream_status",status);
    yyjson_mut_doc_set_root(response,result);
    char *json=yyjson_mut_write(response,0,NULL);
    if(json)reply(fd,200,"application/json",json);
    else reply(fd,500,"application/json","{\"error\":{\"message\":\"Serialization failed\"}}");
    free(json);yyjson_mut_doc_free(response);yyjson_doc_free(doc);
}
