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
static void models_respond(int fd,const yag_config *cfg,const char *model_id) {
    listing response={0};
    long status=0;
    int rc=upstream_perform(cfg,"/models",NULL,0,collect,&response,&status,fd);
    if(rc!=CURLE_OK || status<200 || status>=300) {
        int code=rc==CURLE_OPERATION_TIMEDOUT?504:status==429?429:502;
        fail(fd,code,"Default model provider unavailable or returned an error");
        free(response.bytes);return;
    }
    yyjson_doc *upstream=yyjson_read(response.bytes,response.size,0);
    yyjson_val *root=upstream?yyjson_doc_get_root(upstream):NULL;
    yyjson_val *models=yyjson_obj_get(root,"data");
    if(!yyjson_is_obj(root) || !yyjson_is_arr(models)) {
        fail(fd,502,"Default model provider returned an invalid model list");
        yyjson_doc_free(upstream);free(response.bytes);return;
    }
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);
    if(!d){fail(fd,500,"Out of memory");yyjson_doc_free(upstream);free(response.bytes);return;}
    yyjson_mut_val *output=yyjson_mut_obj(d),*items=yyjson_mut_arr(d);
    int good=output && items && yyjson_mut_obj_add_str(d,output,"object","list")
        && yyjson_mut_obj_add_val(d,output,"data",items);
    size_t i,count;yyjson_val *item;
    if(good)yyjson_arr_foreach(models,i,count,item) {
        yyjson_val *id=yyjson_obj_get(item,"id");
        if(!yyjson_is_obj(item) || !yyjson_is_str(id)
            || !yyjson_get_len(id) || strlen(yyjson_get_str(id))!=yyjson_get_len(id)
            || !yyjson_mut_arr_add_val(items,yyjson_val_mut_copy(d,item))) {
            good=0;break;
        }
    }
    if(good)for(size_t r=0;r<cfg->route_count;r++) {
        int exists=0;
        yyjson_arr_foreach(models,i,count,item) {
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
            || !yyjson_mut_arr_add_val(items,entry)){good=0;break;}
    }
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
                    good=yyjson_mut_obj_add_str(d,match,"object","model")!=NULL;
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
