#include "yag.h"
#include "yyjson.h"
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_RESPONSE_BYTES (4*1024*1024)
typedef struct { char *bytes; size_t size; } response_buffer;

static int string_value(yyjson_val *v) {
    return yyjson_is_str(v) && yyjson_get_len(v)==strlen(yyjson_get_str(v));
}
static int permitted(yyjson_val *object,const char *const *names) {
    if(!yyjson_is_obj(object))return 0;
    yyjson_obj_iter iterator=yyjson_obj_iter_with(object);
    yyjson_val *key;
    while((key=yyjson_obj_iter_next(&iterator))) {
        int found=0;
        for(size_t i=0;names[i];i++)if(yyjson_equals_str(key,names[i])){found=1;break;}
        if(!found)return 0;
    }
    return 1;
}
static void anthropic_error(int fd,int status) {
    if(status==400)reply(fd,400,"application/json",
        "{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"Unsupported Messages input: only non-streaming text is supported\"}}");
    else if(status==429)reply(fd,429,"application/json",
        "{\"type\":\"error\",\"error\":{\"type\":\"api_error\",\"message\":\"Upstream rate limit\"}}");
    else if(status==504)reply(fd,504,"application/json",
        "{\"type\":\"error\",\"error\":{\"type\":\"api_error\",\"message\":\"Upstream timed out\"}}");
    else reply(fd,502,"application/json",
        "{\"type\":\"error\",\"error\":{\"type\":\"api_error\",\"message\":\"Unsupported or unavailable upstream response\"}}");
}
static char *serialize_value(yyjson_val *value) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);
    if(!d)return NULL;
    yyjson_mut_val *copied=yyjson_val_mut_copy(d,value);
    if(!copied){yyjson_mut_doc_free(d);return NULL;}
    yyjson_mut_doc_set_root(d,copied);
    char *json=yyjson_mut_write(d,0,NULL);
    yyjson_mut_doc_free(d);
    return json;
}
static int add_text(yyjson_mut_doc *doc,yyjson_mut_val *message,yyjson_val *content) {
    if(string_value(content))
        return yyjson_mut_obj_add_val(doc,message,"content",yyjson_val_mut_copy(doc,content));
    if(!yyjson_is_arr(content))return 0;
    yyjson_mut_val *parts=yyjson_mut_arr(doc);
    if(!parts)return 0;
    const char *const keys[]={"type","text",NULL};
    const char *const call_keys[]={"type","id","name","input",NULL};
    yyjson_mut_val *calls=yyjson_mut_arr(doc);
    if(!calls)return 0;
    size_t i,max;yyjson_val *item;
    yyjson_arr_foreach(content,i,max,item) {
        yyjson_val *type=yyjson_obj_get(item,"type"),*value=yyjson_obj_get(item,"text");
        if(yyjson_equals_str(type,"tool_use")) {
            yyjson_val *id=yyjson_obj_get(item,"id"),*name=yyjson_obj_get(item,"name");
            yyjson_val *input=yyjson_obj_get(item,"input");
            if(!permitted(item,call_keys) || !string_value(id) || !yyjson_get_len(id)
                || !string_value(name) || !yyjson_get_len(name) || !yyjson_is_obj(input))return 0;
            char *arguments=serialize_value(input);
            if(!arguments)return 0;
            yyjson_mut_val *tool=yyjson_mut_obj(doc),*fn=yyjson_mut_obj(doc);
            int good=tool && fn
                && yyjson_mut_obj_add_str(doc,tool,"type","function")
                && yyjson_mut_obj_add_val(doc,tool,"id",yyjson_val_mut_copy(doc,id))
                && yyjson_mut_obj_add_val(doc,fn,"name",yyjson_val_mut_copy(doc,name))
                && yyjson_mut_obj_add_strcpy(doc,fn,"arguments",arguments)
                && yyjson_mut_obj_add_val(doc,tool,"function",fn)
                && yyjson_mut_arr_add_val(calls,tool);
            free(arguments);
            if(!good)return 0;
            continue;
        }
        if(!permitted(item,keys) || !yyjson_equals_str(type,"text") || !string_value(value))return 0;
        yyjson_mut_val *part=yyjson_mut_obj(doc);
        if(!part || !yyjson_mut_obj_add_str(doc,part,"type","text")
            || !yyjson_mut_obj_add_val(doc,part,"text",yyjson_val_mut_copy(doc,value))
            || !yyjson_mut_arr_add_val(parts,part))return 0;
    }
    if(yyjson_mut_arr_size(calls)) {
        if(!yyjson_mut_obj_add_val(doc,message,"tool_calls",calls))return 0;
        return yyjson_mut_arr_size(parts)
            ? yyjson_mut_obj_add_val(doc,message,"content",parts)
            : yyjson_mut_obj_add_null(doc,message,"content");
    }
    return yyjson_mut_obj_add_val(doc,message,"content",parts);
}
/* Anthropic tool results must precede optional trailing user text. Preserve
 * their order as Chat tool messages, followed by a normal user message. */
static char *tool_result_text(yyjson_val *value) {
    if(!value)return strdup("");
    if(string_value(value))return strdup(yyjson_get_str(value));
    if(!yyjson_is_arr(value))return NULL;
    size_t total=0;const char *const keys[]={"type","text",NULL};
    size_t i,n;yyjson_val *block;
    yyjson_arr_foreach(value,i,n,block) {
        yyjson_val *text=yyjson_obj_get(block,"text");
        if(!permitted(block,keys)
            || !yyjson_equals_str(yyjson_obj_get(block,"type"),"text")
            || !string_value(text))return NULL;
        if(yyjson_get_len(text)>1024*1024-total)return NULL;
        total+=yyjson_get_len(text);
        if(i && ++total>1024*1024)return NULL;
    }
    char *joined=malloc(total+1);if(!joined)return NULL;
    size_t pos=0;
    yyjson_arr_foreach(value,i,n,block) {
        yyjson_val *text=yyjson_obj_get(block,"text");
        if(i)joined[pos++]='\n';
        size_t length=yyjson_get_len(text);
        memcpy(joined+pos,yyjson_get_str(text),length);pos+=length;
    }
    joined[pos]=0;
    return joined;
}
static int add_tool_results(yyjson_mut_doc *d,yyjson_mut_val *messages,yyjson_val *content) {
    if(!yyjson_is_arr(content) || !yyjson_arr_size(content))return 1;
    yyjson_val *first=yyjson_arr_get(content,0);
    if(!yyjson_equals_str(yyjson_obj_get(first,"type"),"tool_result"))return 1;
    const char *const allowed[]={"type","tool_use_id","content","is_error",NULL};
    const char *const text_fields[]={"type","text",NULL};
    yyjson_mut_val *user_parts=yyjson_mut_arr(d);
    if(!user_parts)return 0;
    int seen_text=0;
    size_t i,n;yyjson_val *item;
    yyjson_arr_foreach(content,i,n,item) {
        yyjson_val *type=yyjson_obj_get(item,"type");
        if(yyjson_equals_str(type,"text")) {
            yyjson_val *text=yyjson_obj_get(item,"text");
            if(!permitted(item,text_fields) || !string_value(text))return 0;
            seen_text=1;
            yyjson_mut_val *part=yyjson_mut_obj(d);
            if(!part || !yyjson_mut_obj_add_str(d,part,"type","text")
                || !yyjson_mut_obj_add_val(d,part,"text",yyjson_val_mut_copy(d,text))
                || !yyjson_mut_arr_add_val(user_parts,part))return 0;
            continue;
        }
        if(seen_text || !yyjson_equals_str(type,"tool_result"))return 0;
        yyjson_val *id=yyjson_obj_get(item,"tool_use_id");
        yyjson_val *value=yyjson_obj_get(item,"content");
        yyjson_val *is_error=yyjson_obj_get(item,"is_error");
        if(!permitted(item,allowed) || !string_value(id) || !yyjson_get_len(id)
            || (is_error && !yyjson_is_bool(is_error)))return 0;
        char *text=tool_result_text(value);
        if(!text)return 0;
        if(is_error && yyjson_get_bool(is_error)) {
            const char *prefix="[Tool execution error]\n";
            size_t p=strlen(prefix),length=strlen(text);
            char *marked=malloc(p+length+1);
            if(!marked){free(text);return 0;}
            memcpy(marked,prefix,p);
            memcpy(marked+p,text,length+1);
            free(text);text=marked;
        }
        yyjson_mut_val *message=yyjson_mut_obj(d);
        int ok=message && yyjson_mut_obj_add_str(d,message,"role","tool")
            && yyjson_mut_obj_add_val(d,message,"tool_call_id",yyjson_val_mut_copy(d,id))
            && yyjson_mut_obj_add_strcpy(d,message,"content",text)
            && yyjson_mut_arr_add_val(messages,message);
        free(text);
        if(!ok)return 0;
    }
    if(yyjson_mut_arr_size(user_parts)) {
        yyjson_mut_val *user=yyjson_mut_obj(d);
        if(!user || !yyjson_mut_obj_add_str(d,user,"role","user")
            || !yyjson_mut_obj_add_val(d,user,"content",user_parts)
            || !yyjson_mut_arr_add_val(messages,user))return 0;
    }
    return 2;
}
static yyjson_mut_doc *convert_request(yyjson_val *root) {
    const char *const allowed[]={"model","messages","max_tokens","system",
        "stream","temperature","top_p","stop_sequences","tools","tool_choice",NULL};
    yyjson_val *model=yyjson_obj_get(root,"model"),*items=yyjson_obj_get(root,"messages");
    yyjson_val *max=yyjson_obj_get(root,"max_tokens"),*sys=yyjson_obj_get(root,"system");
    yyjson_val *stream=yyjson_obj_get(root,"stream"),*temp=yyjson_obj_get(root,"temperature");
    yyjson_val *top=yyjson_obj_get(root,"top_p"),*stops=yyjson_obj_get(root,"stop_sequences");
    if(!permitted(root,allowed) || !string_value(model) || !yyjson_get_len(model)
        || !yyjson_is_arr(items) || !yyjson_arr_size(items)
        || !yyjson_is_int(max) || yyjson_get_sint(max)<=0
        || (sys && !string_value(sys))
        || (stream && !yyjson_is_bool(stream))
        || (temp && !yyjson_is_num(temp)) || (top && !yyjson_is_num(top))
        || (stops && !yyjson_is_arr(stops)))return NULL;
    yyjson_mut_doc *doc=yyjson_mut_doc_new(NULL);
    if(!doc)return NULL;
    yyjson_mut_val *chat=yyjson_mut_obj(doc),*messages=yyjson_mut_arr(doc);
    if(!chat || !messages)goto fail;
    yyjson_mut_doc_set_root(doc,chat);
    if(!yyjson_mut_obj_add_val(doc,chat,"model",yyjson_val_mut_copy(doc,model))
        || !yyjson_mut_obj_add_val(doc,chat,"max_tokens",yyjson_val_mut_copy(doc,max))
        || !yyjson_mut_obj_add_bool(doc,chat,"stream",stream && yyjson_get_bool(stream)))goto fail;
    if(sys) {
        yyjson_mut_val *system=yyjson_mut_obj(doc);
        if(!system || !yyjson_mut_obj_add_str(doc,system,"role","system")
            || !yyjson_mut_obj_add_val(doc,system,"content",yyjson_val_mut_copy(doc,sys))
            || !yyjson_mut_arr_add_val(messages,system))goto fail;
    }
    const char *const msg_keys[]={"role","content",NULL};
    size_t i,n;yyjson_val *msg;
    yyjson_arr_foreach(items,i,n,msg) {
        yyjson_val *role=yyjson_obj_get(msg,"role"),*content=yyjson_obj_get(msg,"content");
        if(!permitted(msg,msg_keys)
            || (!yyjson_equals_str(role,"user") && !yyjson_equals_str(role,"assistant")))goto fail;
        if(yyjson_equals_str(role,"user")) {
            int results=add_tool_results(doc,messages,content);
            if(!results)goto fail;
            if(results==2)continue;
        }
        yyjson_mut_val *entry=yyjson_mut_obj(doc);
        if(!entry || !yyjson_mut_obj_add_val(doc,entry,"role",yyjson_val_mut_copy(doc,role))
            || !add_text(doc,entry,content) || !yyjson_mut_arr_add_val(messages,entry))goto fail;
        if(yyjson_equals_str(role,"user") && yyjson_mut_obj_get(entry,"tool_calls"))goto fail;
    }
    if(!yyjson_mut_obj_add_val(doc,chat,"messages",messages))goto fail;
    if(temp && !yyjson_mut_obj_add_val(doc,chat,"temperature",yyjson_val_mut_copy(doc,temp)))goto fail;
    if(top && !yyjson_mut_obj_add_val(doc,chat,"top_p",yyjson_val_mut_copy(doc,top)))goto fail;
    yyjson_val *tools=yyjson_obj_get(root,"tools");
    if(tools) {
        if(!yyjson_is_arr(tools))goto fail;
        yyjson_mut_val *out=yyjson_mut_arr(doc);
        if(!out)goto fail;
        const char *const tool_fields[]={"name","description","input_schema",NULL};
        size_t ti,tn;yyjson_val *tool;
        yyjson_arr_foreach(tools,ti,tn,tool) {
            yyjson_val *name=yyjson_obj_get(tool,"name");
            yyjson_val *desc=yyjson_obj_get(tool,"description");
            yyjson_val *schema=yyjson_obj_get(tool,"input_schema");
            if(!permitted(tool,tool_fields) || !string_value(name) || !yyjson_get_len(name)
                || !yyjson_is_obj(schema) || (desc && !string_value(desc)))goto fail;
            yyjson_mut_val *converted=yyjson_mut_obj(doc),*function=yyjson_mut_obj(doc);
            if(!converted || !function
                || !yyjson_mut_obj_add_str(doc,converted,"type","function")
                || !yyjson_mut_obj_add_val(doc,function,"name",yyjson_val_mut_copy(doc,name))
                || !yyjson_mut_obj_add_val(doc,function,"parameters",yyjson_val_mut_copy(doc,schema))
                || (desc && !yyjson_mut_obj_add_val(doc,function,"description",yyjson_val_mut_copy(doc,desc)))
                || !yyjson_mut_obj_add_val(doc,converted,"function",function)
                || !yyjson_mut_arr_add_val(out,converted))goto fail;
        }
        if(yyjson_arr_size(tools) && !yyjson_mut_obj_add_val(doc,chat,"tools",out))goto fail;
    }
    yyjson_val *choice=yyjson_obj_get(root,"tool_choice");
    if(choice) {
        const char *const choice_fields[]={"type","name","disable_parallel_tool_use",NULL};
        yyjson_val *kind=yyjson_obj_get(choice,"type"),*name=yyjson_obj_get(choice,"name");
        yyjson_val *disable=yyjson_obj_get(choice,"disable_parallel_tool_use");
        if(!permitted(choice,choice_fields)
            || (disable && !yyjson_is_bool(disable))
            || (yyjson_equals_str(kind,"tool")
                ? (!string_value(name) || !yyjson_get_len(name))
                : name!=NULL)
            || (!yyjson_equals_str(kind,"auto") && !yyjson_equals_str(kind,"none")
                && !yyjson_equals_str(kind,"any") && !yyjson_equals_str(kind,"tool"))
            || (!yyjson_arr_size(tools) && !yyjson_equals_str(kind,"none")))goto fail;
        if(disable && !yyjson_mut_obj_add_bool(doc,chat,"parallel_tool_calls",!yyjson_get_bool(disable)))goto fail;
        if(yyjson_equals_str(kind,"tool")) {
            yyjson_mut_val *selector=yyjson_mut_obj(doc),*fn=yyjson_mut_obj(doc);
            if(!selector || !fn || !yyjson_mut_obj_add_str(doc,selector,"type","function")
                || !yyjson_mut_obj_add_val(doc,fn,"name",yyjson_val_mut_copy(doc,name))
                || !yyjson_mut_obj_add_val(doc,selector,"function",fn)
                || !yyjson_mut_obj_add_val(doc,chat,"tool_choice",selector))goto fail;
        } else {
            const char *mapped=yyjson_equals_str(kind,"any")?"required":
                yyjson_equals_str(kind,"none")?"none":"auto";
            if(!yyjson_mut_obj_add_str(doc,chat,"tool_choice",mapped))goto fail;
        }
    }
    if(stops) {
        size_t j,count; yyjson_val *stop;
        yyjson_arr_foreach(stops,j,count,stop)if(!string_value(stop))goto fail;
        if(yyjson_arr_size(stops) && !yyjson_mut_obj_add_val(doc,chat,"stop",yyjson_val_mut_copy(doc,stops)))goto fail;
    }
    return doc;
fail:
    yyjson_mut_doc_free(doc);return NULL;
}
static size_t collect_bytes(void *ctx,long status,const char *mime,const char *bytes,size_t count) {
    (void)status;(void)mime;
    response_buffer *buffer=ctx;
    if(count>MAX_RESPONSE_BYTES || buffer->size>MAX_RESPONSE_BYTES-count)return 0;
    char *allocated=realloc(buffer->bytes,buffer->size+count+1);
    if(!allocated)return 0;
    buffer->bytes=allocated;
    memcpy(buffer->bytes+buffer->size,bytes,count);
    buffer->size+=count;
    buffer->bytes[buffer->size]=0;
    return count;
}
static void convert_response(int fd,yyjson_val *root,yyjson_val *model) {
    yyjson_val *choices=yyjson_obj_get(root,"choices"),*usage=yyjson_obj_get(root,"usage");
    yyjson_val *choice=yyjson_arr_get(choices,0),*message=yyjson_obj_get(choice,"message");
    yyjson_val *content=yyjson_obj_get(message,"content"),*finish=yyjson_obj_get(choice,"finish_reason");
    yyjson_val *calls=yyjson_obj_get(message,"tool_calls");
    int has_calls=yyjson_is_arr(calls) && yyjson_arr_size(calls)>0;
    yyjson_val *input_tokens=yyjson_obj_get(usage,"prompt_tokens"),*output_tokens=yyjson_obj_get(usage,"completion_tokens");
    if(!yyjson_is_arr(choices) || yyjson_arr_size(choices)!=1
        || !yyjson_equals_str(yyjson_obj_get(message,"role"),"assistant")
        || (!string_value(content) && !(has_calls && yyjson_is_null(content)))
        || (has_calls ? !yyjson_equals_str(finish,"tool_calls")
            : (!yyjson_equals_str(finish,"stop") && !yyjson_equals_str(finish,"length")))
        || (calls && !yyjson_is_null(calls) && !has_calls)
        || !yyjson_is_int(input_tokens) || yyjson_get_sint(input_tokens)<0
        || !yyjson_is_int(output_tokens) || yyjson_get_sint(output_tokens)<0) {
        anthropic_error(fd,502);return;
    }
    unsigned char entropy[16];
    FILE *random=fopen("/dev/urandom","rb");
    if(!random){anthropic_error(fd,502);return;}
    int ok=fread(entropy,1,sizeof entropy,random)==sizeof entropy;
    fclose(random);
    if(!ok){anthropic_error(fd,502);return;}
    char id[37]="msg_";
    for(size_t i=0;i<16;i++)snprintf(id+4+2*i,3,"%02x",entropy[i]);
    yyjson_mut_doc *doc=yyjson_mut_doc_new(NULL);
    if(!doc){anthropic_error(fd,502);return;}
    yyjson_mut_val *result=yyjson_mut_obj(doc);
    yyjson_mut_obj_add_str(doc,result,"type","message");
    yyjson_mut_obj_add_strcpy(doc,result,"id",id);
    yyjson_mut_obj_add_str(doc,result,"role","assistant");
    yyjson_mut_obj_add_val(doc,result,"model",yyjson_val_mut_copy(doc,model));
    yyjson_mut_val *blocks=yyjson_mut_obj_add_arr(doc,result,"content");
    if(string_value(content) && yyjson_get_len(content)) {
        yyjson_mut_val *block=yyjson_mut_obj(doc);
        if(!block || !yyjson_mut_obj_add_str(doc,block,"type","text")
            || !yyjson_mut_obj_add_val(doc,block,"text",yyjson_val_mut_copy(doc,content))
            || !yyjson_mut_arr_add_val(blocks,block)) {
            yyjson_mut_doc_free(doc);anthropic_error(fd,502);return;
        }
    }
    if(has_calls) {
        size_t i,n;yyjson_val *call;
        yyjson_arr_foreach(calls,i,n,call) {
            yyjson_val *id=yyjson_obj_get(call,"id"),*fn=yyjson_obj_get(call,"function");
            yyjson_val *name=yyjson_obj_get(fn,"name"),*arguments=yyjson_obj_get(fn,"arguments");
            if(!yyjson_equals_str(yyjson_obj_get(call,"type"),"function")
                || !string_value(id) || !yyjson_get_len(id)
                || !string_value(name) || !yyjson_get_len(name)
                || !string_value(arguments)) {
                yyjson_mut_doc_free(doc);anthropic_error(fd,502);return;
            }
            yyjson_doc *parsed=yyjson_read(yyjson_get_str(arguments),yyjson_get_len(arguments),0);
            yyjson_val *input=parsed?yyjson_doc_get_root(parsed):NULL;
            if(!yyjson_is_obj(input)) {
                yyjson_doc_free(parsed);yyjson_mut_doc_free(doc);anthropic_error(fd,502);return;
            }
            yyjson_mut_val *block=yyjson_mut_obj(doc);
            int valid=block && yyjson_mut_obj_add_str(doc,block,"type","tool_use")
                && yyjson_mut_obj_add_val(doc,block,"id",yyjson_val_mut_copy(doc,id))
                && yyjson_mut_obj_add_val(doc,block,"name",yyjson_val_mut_copy(doc,name))
                && yyjson_mut_obj_add_val(doc,block,"input",yyjson_val_mut_copy(doc,input))
                && yyjson_mut_arr_add_val(blocks,block);
            yyjson_doc_free(parsed);
            if(!valid){yyjson_mut_doc_free(doc);anthropic_error(fd,502);return;}
        }
    }
    yyjson_mut_obj_add_str(doc,result,"stop_reason",has_calls?"tool_use":
        yyjson_equals_str(finish,"length")?"max_tokens":"end_turn");
    yyjson_mut_obj_add_null(doc,result,"stop_sequence");
    yyjson_mut_val *usage_result=yyjson_mut_obj_add_obj(doc,result,"usage");
    yyjson_mut_obj_add_sint(doc,usage_result,"input_tokens",yyjson_get_sint(input_tokens));
    yyjson_mut_obj_add_sint(doc,usage_result,"output_tokens",yyjson_get_sint(output_tokens));
    yyjson_mut_doc_set_root(doc,result);
    char *json=yyjson_mut_write(doc,0,NULL);
    if(json)reply(fd,200,"application/json",json);
    else anthropic_error(fd,502);
    free(json);yyjson_mut_doc_free(doc);
}
void anthropic_messages_handle(int fd,const yag_config *cfg,const char *body,size_t size) {
    yyjson_doc *request=yyjson_read(body,size,0);
    yyjson_val *root=request?yyjson_doc_get_root(request):NULL;
    yyjson_mut_doc *translated=convert_request(root);
    if(!translated){anthropic_error(fd,400);yyjson_doc_free(request);return;}
    char *json=yyjson_mut_write(translated,0,NULL);
    yyjson_mut_doc_free(translated);
    if(!json){anthropic_error(fd,502);yyjson_doc_free(request);return;}
    yag_config selected={0};
    const yag_config *target=config_for_model(cfg,yyjson_get_str(yyjson_obj_get(root,"model")),&selected);
    yyjson_val *requested_stream=yyjson_obj_get(root,"stream");
    if(requested_stream && yyjson_get_bool(requested_stream)) {
        anthropic_stream_handle(fd,target,yyjson_get_str(yyjson_obj_get(root,"model")),json);
        free(json);yyjson_doc_free(request);return;
    }
    response_buffer data={0};
    long status=0;
    int rc=upstream_perform(target,"/chat/completions",json,strlen(json),collect_bytes,&data,&status,fd);
    if(rc!=CURLE_OK || status<200 || status>=300)
        anthropic_error(fd,rc==CURLE_OPERATION_TIMEDOUT?504:status==429?429:502);
    else {
        yyjson_doc *backend=yyjson_read(data.bytes,data.size,0);
        convert_response(fd,backend?yyjson_doc_get_root(backend):NULL,yyjson_obj_get(root,"model"));
        yyjson_doc_free(backend);
    }
    free(json);free(data.bytes);yyjson_doc_free(request);
}
