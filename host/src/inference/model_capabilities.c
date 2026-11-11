#include "yag.h"
#include "yyjson.h"
#include <stdlib.h>

/* Deliberately no inferred capabilities: all records are operator assertions.
 * It is not model probing or a guarantee of backend API support. */
static const char *const features[]={
    "streaming","function_tools","json_schema","reasoning","vision","audio",NULL
};
void model_capabilities_handle(int fd,const yag_config *cfg) {
    yyjson_mut_doc *doc=yyjson_mut_doc_new(NULL);
    if(!doc){
        reply(fd,500,"application/json","{\"error\":{\"message\":\"Out of memory\"}}");
        return;
    }
    yyjson_mut_val *root=yyjson_mut_obj(doc);
    yyjson_mut_val *array=yyjson_mut_obj_add_arr(doc,root,"data");
    yyjson_mut_obj_add_str(doc,root,"object","gateway.model_capabilities");
    yyjson_mut_obj_add_str(doc,root,"source","operator_configuration");
    yyjson_mut_obj_add_bool(doc,root,"verified",0);
    for(size_t i=0;i<cfg->capability_count;i++) {
        const yag_model_capability *cap=&cfg->capabilities[i];
        yyjson_mut_val *row=yyjson_mut_obj(doc);
        yyjson_mut_obj_add_strcpy(doc,row,"model",cap->model);
        yyjson_mut_obj_add_bool(doc,row,"verified",0);
        if(cap->has_context_window)
            yyjson_mut_obj_add_uint(doc,row,"context_window",cap->context_window);
        else yyjson_mut_obj_add_null(doc,row,"context_window");
        yyjson_mut_val *list=yyjson_mut_obj_add_arr(doc,row,"features");
        for(unsigned j=0;features[j];j++)if(cap->feature_mask & (1u<<j))
            yyjson_mut_arr_add_str(doc,list,features[j]);
        yyjson_mut_arr_add_val(array,row);
    }
    yyjson_mut_doc_set_root(doc,root);
    char *json=yyjson_mut_write(doc,0,NULL);
    if(json)reply(fd,200,"application/json",json);
    else reply(fd,500,"application/json",
        "{\"error\":{\"message\":\"Capability serialization error\"}}");
    free(json);yyjson_mut_doc_free(doc);
}
