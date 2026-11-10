#include "responses.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

static int isstr(yyjson_val *v) { return yyjson_is_str(v) && strlen(yyjson_get_str(v))==yyjson_get_len(v); }
static int eq(yyjson_val *v,const char *s) { return yyjson_is_str(v) && yyjson_equals_str(v,s); }
static int keys(yyjson_val *obj,const char *const *allowed) {
    if(!yyjson_is_obj(obj)) return 0;
    yyjson_obj_iter it=yyjson_obj_iter_with(obj); yyjson_val *k;
    while((k=yyjson_obj_iter_next(&it))) { const char *s=yyjson_get_str(k); int found=0; for(int i=0;allowed[i];i++) if(yyjson_equals_str(k,allowed[i])) {found=1;break;} if(!found || strlen(s)!=yyjson_get_len(k))return 0; }
    return 1;
}
static int copy(yyjson_mut_doc *d,yyjson_mut_val *o,const char *key,yyjson_val *v) {
    return v && yyjson_mut_obj_add_val(d,o,key,yyjson_val_mut_copy(d,v));
}
static int add_message(yyjson_mut_doc *d,yyjson_mut_val *arr,const char *role,yyjson_val *content) {
    yyjson_mut_val *m=yyjson_mut_obj(d); if(!m || !yyjson_mut_obj_add_str(d,m,"role",role))return 0;
    if(yyjson_is_str(content)) { if(!copy(d,m,"content",content))return 0; }
    else if(yyjson_is_arr(content)) {
        yyjson_mut_val *parts=yyjson_mut_arr(d); if(!parts)return 0;
        size_t i,max; yyjson_val *p;
        const char *const allowed[]={"type","text","annotations","logprobs",NULL};
        yyjson_arr_foreach(content,i,max,p) {
            yyjson_val *type=yyjson_obj_get(p,"type"),*text=yyjson_obj_get(p,"text"),*ann=yyjson_obj_get(p,"annotations"),*logs=yyjson_obj_get(p,"logprobs");
            if(!keys(p,allowed) || (!eq(type,"input_text") && !eq(type,"output_text")) || !isstr(text) || (ann && (!yyjson_is_arr(ann) || yyjson_arr_size(ann))) || (logs && (!yyjson_is_arr(logs) || yyjson_arr_size(logs))))return 0;
            yyjson_mut_val *part=yyjson_mut_obj(d); if(!part || !yyjson_mut_obj_add_str(d,part,"type","text") || !copy(d,part,"text",text) || !yyjson_mut_arr_add_val(parts,part))return 0;
        }
        if(!yyjson_mut_obj_add_val(d,m,"content",parts))return 0;
    } else return 0;
    return yyjson_mut_arr_add_val(arr,m);
}
/* Replayed item metadata must not claim that an unfinished item is complete. */
static int replay_metadata(yyjson_val *item) {
    yyjson_val *id=yyjson_obj_get(item,"id"),*status=yyjson_obj_get(item,"status");
    return (!id || isstr(id)) && (!status || eq(status,"completed"));
}
static int add_call(yyjson_mut_doc *d,yyjson_mut_val *messages,yyjson_val *item) {
    const char *const allowed[]={"type","id","call_id","name","arguments","status",NULL};
    yyjson_val *call=yyjson_obj_get(item,"call_id"),*name=yyjson_obj_get(item,"name"),*args=yyjson_obj_get(item,"arguments");
    if(!keys(item,allowed) || !replay_metadata(item) || !isstr(call) || !*yyjson_get_str(call) || !isstr(name) || !*yyjson_get_str(name) || !isstr(args))return 0;
    yyjson_mut_val *last=yyjson_mut_arr_get_last(messages),*role=last?yyjson_mut_obj_get(last,"role"):NULL,*calls=NULL;
    if(role && yyjson_mut_equals_str(role,"assistant")) calls=yyjson_mut_obj_get(last,"tool_calls");
    else { last=yyjson_mut_obj(d); if(!last || !yyjson_mut_obj_add_str(d,last,"role","assistant") || !yyjson_mut_obj_add_null(d,last,"content") || !yyjson_mut_arr_add_val(messages,last))return 0; }
    if(!calls) { calls=yyjson_mut_arr(d); if(!calls || !yyjson_mut_obj_add_val(d,last,"tool_calls",calls))return 0; }
    yyjson_mut_val *t=yyjson_mut_obj(d),*f=yyjson_mut_obj(d);
    return t && f && yyjson_mut_obj_add_str(d,t,"type","function") && copy(d,t,"id",call) && copy(d,f,"name",name) && copy(d,f,"arguments",args) && yyjson_mut_obj_add_val(d,t,"function",f) && yyjson_mut_arr_add_val(calls,t);
}
static int add_result(yyjson_mut_doc *d,yyjson_mut_val *messages,yyjson_val *item) {
    const char *const allowed[]={"type","id","call_id","output","status",NULL};
    yyjson_val *call=yyjson_obj_get(item,"call_id"),*output=yyjson_obj_get(item,"output");
    if(!keys(item,allowed) || !replay_metadata(item) || !isstr(call) || !*yyjson_get_str(call) || !isstr(output))return 0;
    yyjson_mut_val *m=yyjson_mut_obj(d);
    return m && yyjson_mut_obj_add_str(d,m,"role","tool") && copy(d,m,"tool_call_id",call) && copy(d,m,"content",output) && yyjson_mut_arr_add_val(messages,m);
}
static int translate_input(yyjson_mut_doc *d,yyjson_mut_val *messages,yyjson_val *input) {
    if(isstr(input))return add_message(d,messages,"user",input);
    if(!yyjson_is_arr(input))return 0;
    const char *const allowed[]={"type","role","content","id","status",NULL};
    size_t i,max; yyjson_val *item;
    yyjson_arr_foreach(input,i,max,item) {
        yyjson_val *type=yyjson_obj_get(item,"type"),*role=yyjson_obj_get(item,"role");
        if(eq(type,"function_call")) {if(!add_call(d,messages,item))return 0;}
        else if(eq(type,"function_call_output")) {if(!add_result(d,messages,item))return 0;}
        else if((!type || eq(type,"message")) && keys(item,allowed) && replay_metadata(item) && isstr(role) && (eq(role,"user") || eq(role,"assistant") || eq(role,"system") || eq(role,"developer"))) {
            if(!add_message(d,messages,yyjson_get_str(role),yyjson_obj_get(item,"content")))return 0;
        } else return 0;
    }
    return 1;
}
static int translate_tools(yyjson_mut_doc *d,yyjson_mut_val *chat,yyjson_val *tools) {
    if(!yyjson_is_arr(tools))return 0;
    yyjson_mut_val *out=yyjson_mut_arr(d); if(!out)return 0;
    const char *const allowed[]={"type","name","description","parameters","strict",NULL};
    size_t i,max; yyjson_val *tool;
    yyjson_arr_foreach(tools,i,max,tool) {
        yyjson_val *name=yyjson_obj_get(tool,"name"),*desc=yyjson_obj_get(tool,"description"),*params=yyjson_obj_get(tool,"parameters"),*strict=yyjson_obj_get(tool,"strict");
        if(!keys(tool,allowed) || !eq(yyjson_obj_get(tool,"type"),"function") || !isstr(name) || !*yyjson_get_str(name) || (desc && !isstr(desc) && !yyjson_is_null(desc)) || (params && !yyjson_is_obj(params) && !yyjson_is_null(params)) || (strict && !yyjson_is_bool(strict) && !yyjson_is_null(strict)))return 0;
        yyjson_mut_val *t=yyjson_mut_obj(d),*f=yyjson_mut_obj(d); if(!t || !f || !copy(d,f,"name",name))return 0;
        if(desc && !copy(d,f,"description",desc))return 0;
        if(params && !copy(d,f,"parameters",params))return 0;
        if(strict && !copy(d,f,"strict",strict))return 0;
        if(!yyjson_mut_obj_add_str(d,t,"type","function") || !yyjson_mut_obj_add_val(d,t,"function",f) || !yyjson_mut_arr_add_val(out,t))return 0;
    }
    /* Many chat servers reject an empty tools array. */
    return !yyjson_arr_size(tools) || yyjson_mut_obj_add_val(d,chat,"tools",out);
}
static int translate_choice(yyjson_mut_doc *d,yyjson_mut_val *chat,yyjson_val *v) {
    if(eq(v,"auto") || eq(v,"none") || eq(v,"required"))return copy(d,chat,"tool_choice",v);
    const char *const allowed[]={"type","name",NULL}; yyjson_val *name=yyjson_obj_get(v,"name");
    if(!keys(v,allowed) || !eq(yyjson_obj_get(v,"type"),"function") || !isstr(name))return 0;
    yyjson_mut_val *choice=yyjson_mut_obj(d),*f=yyjson_mut_obj(d);
    return choice && f && copy(d,f,"name",name) && yyjson_mut_obj_add_str(d,choice,"type","function") && yyjson_mut_obj_add_val(d,choice,"function",f) && yyjson_mut_obj_add_val(d,chat,"tool_choice",choice);
}
int responses_parse(const char *body,size_t len,response_request *r,const char **err) {
    memset(r,0,sizeof *r); *err="Invalid Responses request";
    r->input_doc=yyjson_read(body,len,0); r->root=r->input_doc?yyjson_doc_get_root(r->input_doc):NULL;
    const char *const top[]={"model","input","instructions","tools","tool_choice","parallel_tool_calls","max_output_tokens","temperature","top_p","stream","text","reasoning","metadata","store","prompt_cache_key","include","client_metadata",NULL};
    if(!yyjson_is_obj(r->root)) { *err="Request must be a JSON object";return 0; }
    if(!keys(r->root,top)) {
        yyjson_obj_iter iter=yyjson_obj_iter_with(r->root); yyjson_val *key;
        while((key=yyjson_obj_iter_next(&iter))) { int found=0; for(int i=0;top[i];i++) if(yyjson_equals_str(key,top[i])){found=1;break;}
            if(!found || !isstr(key)) {snprintf(r->diagnostic,sizeof r->diagnostic,"Unsupported request field: %.160s",isstr(key)?yyjson_get_str(key):"invalid name"); *err=r->diagnostic; return 0;}
        }
        *err="Invalid request field";return 0;
    }
    yyjson_val *model=yyjson_obj_get(r->root,"model"),*input=yyjson_obj_get(r->root,"input"),*inst=yyjson_obj_get(r->root,"instructions"),*stream=yyjson_obj_get(r->root,"stream"),*store=yyjson_obj_get(r->root,"store"),*meta=yyjson_obj_get(r->root,"metadata");
    if(!isstr(model) || !*yyjson_get_str(model) || !input || (inst && !isstr(inst) && !yyjson_is_null(inst)) || (stream && !yyjson_is_bool(stream)) || (store && (!yyjson_is_bool(store) || yyjson_get_bool(store))) || (meta && !yyjson_is_obj(meta) && !yyjson_is_null(meta))) { *err="Invalid model, input, instructions, stream, metadata or store (only store=false is supported)"; return 0; }
    yyjson_val *include=yyjson_obj_get(r->root,"include");
    if(include && (!yyjson_is_arr(include) || yyjson_arr_size(include)!=0)) { *err="Only an empty include array is supported; requested output fields cannot be synthesized";return 0; }
    yyjson_val *client_metadata=yyjson_obj_get(r->root,"client_metadata");
    if(client_metadata && !yyjson_is_obj(client_metadata) && !yyjson_is_null(client_metadata)) { *err="client_metadata must be an object or null";return 0; }
    r->stream=stream && yyjson_get_bool(stream);
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL); if(!d){*err="Out of memory";return 0;} yyjson_mut_val *chat=yyjson_mut_obj(d),*messages=yyjson_mut_arr(d); int ok=0;
    if(!chat || !messages)goto done;
    yyjson_mut_doc_set_root(d,chat);
    if(!copy(d,chat,"model",model) || !yyjson_mut_obj_add_bool(d,chat,"stream",r->stream))goto done;
    if(inst && !yyjson_is_null(inst) && !add_message(d,messages,"system",inst))goto done;
    if(!translate_input(d,messages,input) || !yyjson_mut_obj_add_val(d,chat,"messages",messages)) { *err="Unsupported input item or content; only text messages and function calls/results are supported";goto done; }
    yyjson_val *v=yyjson_obj_get(r->root,"tools"); if(v && !translate_tools(d,chat,v)){*err="Only function tools are supported";goto done;}
    v=yyjson_obj_get(r->root,"tool_choice");if(v && !yyjson_is_null(v) && !translate_choice(d,chat,v)){*err="Unsupported tool_choice";goto done;}
    v=yyjson_obj_get(r->root,"parallel_tool_calls");if(v && (!yyjson_is_bool(v) || !copy(d,chat,"parallel_tool_calls",v))){*err="parallel_tool_calls must be boolean";goto done;}
    v=yyjson_obj_get(r->root,"max_output_tokens");if(v && (!yyjson_is_int(v) || yyjson_get_sint(v)<=0 || !copy(d,chat,"max_tokens",v))){*err="max_output_tokens must be a positive integer";goto done;}
    const char *numbers[]={"temperature","top_p",NULL}; for(int i=0;numbers[i];i++){v=yyjson_obj_get(r->root,numbers[i]);if(v && (!yyjson_is_num(v) || !copy(d,chat,numbers[i],v))){*err="Invalid generation parameter";goto done;}}
    v=yyjson_obj_get(r->root,"reasoning"); if(v && !yyjson_is_null(v)){ const char *const a[]={"effort",NULL}; yyjson_val *eff=yyjson_obj_get(v,"effort"); if(!keys(v,a) || (eff && !yyjson_is_null(eff) && !(eq(eff,"none") || eq(eff,"minimal") || eq(eff,"low") || eq(eff,"medium") || eq(eff,"high") || eq(eff,"xhigh") || eq(eff,"max")))){*err="Only reasoning.effort is supported";goto done;} if(eff && !yyjson_is_null(eff) && !copy(d,chat,"reasoning_effort",eff))goto done; }
    v=yyjson_obj_get(r->root,"prompt_cache_key"); if(v && !yyjson_is_null(v) && (!isstr(v) || !copy(d,chat,"prompt_cache_key",v))){*err="Invalid prompt_cache_key";goto done;}
    v=yyjson_obj_get(r->root,"text"); if(v && !yyjson_is_null(v)){
        const char *const a[]={"format","verbosity",NULL}; yyjson_val *f=yyjson_obj_get(v,"format"),*verbosity=yyjson_obj_get(v,"verbosity");
        if(!keys(v,a) || (verbosity && !yyjson_is_null(verbosity) && !(eq(verbosity,"low") || eq(verbosity,"medium") || eq(verbosity,"high")))){*err="Unsupported text configuration";goto done;}
        if(verbosity && !yyjson_is_null(verbosity) && !copy(d,chat,"verbosity",verbosity))goto done;
        if(f && !yyjson_is_null(f)) {
            yyjson_val *type=yyjson_obj_get(f,"type");
            if((eq(type,"text") || eq(type,"json_object")) && yyjson_obj_size(f)==1) {if(!copy(d,chat,"response_format",f))goto done;}
            else if(eq(type,"json_schema")) {
                const char *const formats[]={"type","name","schema","description","strict",NULL}; yyjson_val *name=yyjson_obj_get(f,"name"),*schema=yyjson_obj_get(f,"schema"),*desc=yyjson_obj_get(f,"description"),*strict=yyjson_obj_get(f,"strict");
                if(!keys(f,formats) || !isstr(name) || !yyjson_is_obj(schema) || (desc && !isstr(desc)) || (strict && !yyjson_is_bool(strict))) {*err="Invalid JSON schema text format";goto done;}
                yyjson_mut_val *format=yyjson_mut_obj(d),*spec=yyjson_mut_obj(d);
                if(!format || !spec || !yyjson_mut_obj_add_str(d,format,"type","json_schema") || !copy(d,spec,"name",name) || !copy(d,spec,"schema",schema))goto done;
                if(desc && !copy(d,spec,"description",desc))goto done;
                if(strict && !copy(d,spec,"strict",strict))goto done;
                if(!yyjson_mut_obj_add_val(d,format,"json_schema",spec) || !yyjson_mut_obj_add_val(d,chat,"response_format",format))goto done;
            } else {*err="Unsupported text.format";goto done;}
        }
    }
    r->chat_json=yyjson_mut_write(d,0,NULL); if(!r->chat_json)goto done; ok=1;
done: yyjson_mut_doc_free(d);return ok;
}
void responses_request_free(response_request *r) { free(r->chat_json); yyjson_doc_free(r->input_doc); }
