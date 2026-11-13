#include "responses.h"
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#define LIMIT (4*1024*1024)
#define MAX_ITEMS 64

typedef struct { char *p; size_t len; } buffer;
typedef struct { int kind, upstream_index, started; char id[64]; buffer name, call, value; } item;
typedef struct {
    int fd, streaming, sent, failed, done, finish, seq;
    char response_id[64], seed[33]; time_t created;
    response_request *request;
    item items[MAX_ITEMS]; size_t count;
    buffer line, event, raw;
    char content_type[128];
    long input_tokens, output_tokens, total_tokens;
    int has_usage;
    const char *error;
    char error_message[512];
} state;
static int append(buffer *b,const char *p,size_t n) {
    if(n>LIMIT || b->len>LIMIT-n)return 0;
    char *x=realloc(b->p,b->len+n+1); if(!x)return 0;
    b->p=x; memcpy(x+b->len,p,n); b->len+=n; x[b->len]=0;return 1;
}
static const char *str(buffer *b) {return b->p?b->p:"";}
static int identifier(state *s) {
    unsigned char b[16]; FILE *f=fopen("/dev/urandom","rb"); if(!f)return 0; size_t n=fread(b,1,sizeof b,f);fclose(f);if(n!=sizeof b)return 0;
    for(size_t i=0;i<sizeof b;i++)snprintf(s->seed+i*2,3,"%02x",b[i]);
    snprintf(s->response_id,sizeof s->response_id,"resp_%s",s->seed);return 1;
}
static yyjson_mut_val *part(yyjson_mut_doc *d,const char *text) {
    yyjson_mut_val *p=yyjson_mut_obj(d); yyjson_mut_obj_add_str(d,p,"type","output_text");yyjson_mut_obj_add_strcpy(d,p,"text",text);yyjson_mut_obj_add_arr(d,p,"annotations"); return p;
}
/* Reverse only names that appear in an explicitly declared namespace.
 * An ordinary function containing "__" must keep its original name. */
static const char *visible_name(state *s,const char *flat,const char **namespace) {
    *namespace=NULL;
    yyjson_val *tools=yyjson_obj_get(s->request->root,"tools");
    if(!yyjson_is_arr(tools))return flat;
    size_t i,n;yyjson_val *tool;
    yyjson_arr_foreach(tools,i,n,tool) {
        if(!yyjson_equals_str(yyjson_obj_get(tool,"type"),"namespace"))continue;
        yyjson_val *ns=yyjson_obj_get(tool,"name"),*members=yyjson_obj_get(tool,"tools");
        if(!yyjson_is_str(ns) || !yyjson_is_arr(members))continue;
        size_t j,count;yyjson_val *member;
        yyjson_arr_foreach(members,j,count,member) {
            yyjson_val *name=yyjson_obj_get(member,"name");
            if(!yyjson_is_str(name))continue;
            char combined[128];
            int length=snprintf(combined,sizeof combined,"%s__%s",
                yyjson_get_str(ns),yyjson_get_str(name));
            if(length>0 && (size_t)length<sizeof combined && !strcmp(flat,combined)) {
                *namespace=yyjson_get_str(ns);
                return yyjson_get_str(name);
            }
        }
    }
    return flat;
}
static yyjson_mut_val *item_json(yyjson_mut_doc *d,state *s,item *it,int complete,int incomplete) {
    yyjson_mut_val *o=yyjson_mut_obj(d); yyjson_mut_obj_add_strcpy(d,o,"id",it->id);
    yyjson_mut_obj_add_str(d,o,"status",!complete?"in_progress":incomplete?"incomplete":"completed");
    if(it->kind==1) {
        yyjson_mut_obj_add_str(d,o,"type","message"); yyjson_mut_obj_add_str(d,o,"role","assistant");
        yyjson_mut_val *content=yyjson_mut_obj_add_arr(d,o,"content"); if(complete)yyjson_mut_arr_add_val(content,part(d,str(&it->value)));
    } else {
        const char *ns=NULL,*name=visible_name(s,str(&it->name),&ns);
        yyjson_mut_obj_add_str(d,o,"type","function_call"); yyjson_mut_obj_add_strcpy(d,o,"call_id",str(&it->call));
        yyjson_mut_obj_add_strcpy(d,o,"name",name);
        if(ns)yyjson_mut_obj_add_strcpy(d,o,"namespace",ns);
        yyjson_mut_obj_add_strcpy(d,o,"arguments",complete?str(&it->value):"");
    }
    return o;
}
static yyjson_mut_val *response_json(yyjson_mut_doc *d,state *s,int final) {
    yyjson_mut_val *o=yyjson_mut_obj(d); yyjson_mut_obj_add_strcpy(d,o,"id",s->response_id); yyjson_mut_obj_add_str(d,o,"object","response"); yyjson_mut_obj_add_sint(d,o,"created_at",s->created);
    yyjson_mut_obj_add_str(d,o,"status",!final?"in_progress":s->finish==2 || s->finish==3?"incomplete":"completed");
    yyjson_mut_obj_add_val(d,o,"model",yyjson_val_mut_copy(d,yyjson_obj_get(s->request->root,"model")));
    yyjson_mut_val *out=yyjson_mut_obj_add_arr(d,o,"output"); if(final)for(size_t i=0;i<s->count;i++) yyjson_mut_arr_add_val(out,item_json(d,s,&s->items[i],1,s->finish==2 || s->finish==3));
    yyjson_mut_obj_add_null(d,o,"error");
    if(final && (s->finish==2 || s->finish==3)) { yyjson_mut_val *detail=yyjson_mut_obj_add_obj(d,o,"incomplete_details"); yyjson_mut_obj_add_str(d,detail,"reason",s->finish==2?"max_output_tokens":"content_filter"); } else yyjson_mut_obj_add_null(d,o,"incomplete_details");
    if(final && s->has_usage) { yyjson_mut_val *u=yyjson_mut_obj_add_obj(d,o,"usage"); yyjson_mut_obj_add_sint(d,u,"input_tokens",s->input_tokens);yyjson_mut_obj_add_sint(d,u,"output_tokens",s->output_tokens);yyjson_mut_obj_add_sint(d,u,"total_tokens",s->total_tokens); }
    else yyjson_mut_obj_add_null(d,o,"usage");
    yyjson_val *metadata=yyjson_obj_get(s->request->root,"metadata"); if(metadata) yyjson_mut_obj_add_val(d,o,"metadata",yyjson_val_mut_copy(d,metadata)); else yyjson_mut_obj_add_null(d,o,"metadata");
    return o;
}
static int event_send(state *s,const char *type,yyjson_mut_doc *d,yyjson_mut_val *root) {
    if(!s->streaming) {yyjson_mut_doc_free(d);return 1;}
    yyjson_mut_obj_add_str(d,root,"type",type); yyjson_mut_obj_add_int(d,root,"sequence_number",s->seq++);yyjson_mut_doc_set_root(d,root);
    char *json=yyjson_mut_write(d,0,NULL); yyjson_mut_doc_free(d);if(!json)return 0;
    if(!s->sent) { const char *header="HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"; if(send_all(s->fd,header,strlen(header))){free(json);return 0;} s->sent=1; }
    int ok=!send_all(s->fd,"event: ",7) && !send_all(s->fd,type,strlen(type)) && !send_all(s->fd,"\ndata: ",7) && !send_all(s->fd,json,strlen(json)) && !send_all(s->fd,"\n\n",2);free(json);return ok;
}
static int response_event(state *s,const char *type,int final) { yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d)return 0; yyjson_mut_val *e=yyjson_mut_obj(d);yyjson_mut_obj_add_val(d,e,"response",response_json(d,s,final));return event_send(s,type,d,e); }
static int item_event(state *s,const char *type,size_t idx,int complete) { yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d)return 0;yyjson_mut_val *e=yyjson_mut_obj(d);yyjson_mut_obj_add_uint(d,e,"output_index",idx);yyjson_mut_obj_add_val(d,e,"item",item_json(d,s,&s->items[idx],complete,s->finish==2 || s->finish==3));return event_send(s,type,d,e); }
static int content_event(state *s,const char *type,size_t idx,const char *field,const char *value) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d)return 0;yyjson_mut_val *e=yyjson_mut_obj(d);yyjson_mut_obj_add_strcpy(d,e,"item_id",s->items[idx].id);yyjson_mut_obj_add_uint(d,e,"output_index",idx);
    if(s->items[idx].kind==1)yyjson_mut_obj_add_int(d,e,"content_index",0);
    if(!strcmp(field,"part"))yyjson_mut_obj_add_val(d,e,"part",part(d,value));else yyjson_mut_obj_add_strcpy(d,e,field,value);
    if(!strcmp(type,"response.output_text.delta") || !strcmp(type,"response.output_text.done"))yyjson_mut_obj_add_arr(d,e,"logprobs");
    if(!strcmp(type,"response.function_call_arguments.done")) {
        const char *ns=NULL;
        const char *name=visible_name(s,str(&s->items[idx].name),&ns);
        yyjson_mut_obj_add_strcpy(d,e,"name",name);
    }
    return event_send(s,type,d,e);
}
static int begin(state *s) { return s->seq || !s->streaming || (response_event(s,"response.created",0) && response_event(s,"response.in_progress",0)); }
static int new_item(state *s,int kind,int upstream_index) {
    if(s->count>=MAX_ITEMS)return -1;
    size_t idx=s->count++;item *it=&s->items[idx];it->kind=kind;it->upstream_index=upstream_index;snprintf(it->id,sizeof it->id,"%s_%s_%zu",kind==1?"msg":"fc",s->seed,idx);return (int)idx;
}
static int start_item(state *s,size_t idx) {
    item *it=&s->items[idx];if(it->started)return 1;
    if(it->kind==2 && (!it->name.len || !it->call.len))return 0;
    for(size_t earlier=0;earlier<idx;earlier++) if(!s->items[earlier].started && !start_item(s,earlier))return 0;
    if(!item_event(s,"response.output_item.added",idx,0))return 0;
    if(it->kind==1 && !content_event(s,"response.content_part.added",idx,"part",""))return 0;
    it->started=1; return 1;
}
static int text_delta(state *s,const char *text,size_t n) {
    if(!n)return 1;
    size_t i;for(i=0;i<s->count;i++)if(s->items[i].kind==1)break;
    if(i==s->count && new_item(s,1,0)<0)return 0;
    if(!start_item(s,i) || !append(&s->items[i].value,text,n))return 0;
    return content_event(s,"response.output_text.delta",i,"delta",text);
}
static int call_delta(state *s,yyjson_val *v) {
    yyjson_val *index=yyjson_obj_get(v,"index"),*id=yyjson_obj_get(v,"id"),*type=yyjson_obj_get(v,"type"),*fn=yyjson_obj_get(v,"function");
    if(!yyjson_is_int(index) || yyjson_get_sint(index)<0 || yyjson_get_sint(index)>1000 || (type && !yyjson_equals_str(type,"function")) || (id && !yyjson_is_str(id)) || (fn && !yyjson_is_obj(fn)))return 0;
    size_t i; int upstream=(int)yyjson_get_sint(index);for(i=0;i<s->count;i++)if(s->items[i].kind==2 && s->items[i].upstream_index==upstream)break;
    if(i==s->count && new_item(s,2,upstream)<0)return 0;
    item *it=&s->items[i];
    yyjson_val *name=yyjson_obj_get(fn,"name"),*args=yyjson_obj_get(fn,"arguments");
    if((name && (!yyjson_is_str(name) || strlen(yyjson_get_str(name))!=yyjson_get_len(name))) || (args && !yyjson_is_str(args)) || (id && strlen(yyjson_get_str(id))!=yyjson_get_len(id)))return 0;
    if(id && yyjson_get_len(id)) {
        const char *idstr=yyjson_get_str(id);
        if(it->call.len && !strcmp(str(&it->call),idstr)) { /* Some runtimes repeat the complete ID. */ }
        else if(it->started || !append(&it->call,idstr,yyjson_get_len(id)))return 0;
    }
    if(name && yyjson_get_len(name)) {if(it->started || !append(&it->name,yyjson_get_str(name),yyjson_get_len(name)))return 0;}
    if(args && yyjson_get_len(args)) {
        const char *delta=yyjson_get_str(args); if(strlen(delta)!=yyjson_get_len(args) || !start_item(s,i) || !append(&it->value,delta,yyjson_get_len(args)))return 0;
        if(!content_event(s,"response.function_call_arguments.delta",i,"delta",delta))return 0;
    }
    return 1;
}
static int finish_items(state *s) {
    for(size_t i=0;i<s->count;i++) {item *it=&s->items[i]; if(!start_item(s,i))return 0;
        if(it->kind==1) {if(!content_event(s,"response.output_text.done",i,"text",str(&it->value)) || !content_event(s,"response.content_part.done",i,"part",str(&it->value)))return 0;}
        else if(!content_event(s,"response.function_call_arguments.done",i,"arguments",str(&it->value)))return 0;
        if(!item_event(s,"response.output_item.done",i,1))return 0;
    }
    return 1;
}
static int usage(state *s,yyjson_val *u) {
    if(!u || yyjson_is_null(u))return 1;
    yyjson_val *a=yyjson_obj_get(u,"prompt_tokens"),*b=yyjson_obj_get(u,"completion_tokens"),*c=yyjson_obj_get(u,"total_tokens");
    if(!yyjson_is_int(a) || !yyjson_is_int(b) || !yyjson_is_int(c) || yyjson_get_sint(a)<0 || yyjson_get_sint(b)<0 || yyjson_get_sint(c)<0)return 0;
    s->input_tokens=yyjson_get_sint(a);s->output_tokens=yyjson_get_sint(b);s->total_tokens=yyjson_get_sint(c);s->has_usage=1;return 1;
}
static int finish_reason(state *s,yyjson_val *v) {
    if(!v || yyjson_is_null(v))return 1;
    if(yyjson_equals_str(v,"stop") || yyjson_equals_str(v,"tool_calls"))s->finish=1;
    else if(yyjson_equals_str(v,"length"))s->finish=2;
    else if(yyjson_equals_str(v,"content_filter"))s->finish=3;
    else return 0;
    return 1;
}
/* Do not silently drop new upstream content modalities or provider extensions.
 * Null extension fields carry no content, but unknown non-null fields are rejected. */
static int known_fields(yyjson_val *obj,const char *const *names) {
    if(!yyjson_is_obj(obj))return 0;
    yyjson_obj_iter it=yyjson_obj_iter_with(obj); yyjson_val *key;
    while((key=yyjson_obj_iter_next(&it))) {
        int known=0; for(int i=0;names[i];i++)if(yyjson_equals_str(key,names[i])){known=1;break;}
        if(!known && !yyjson_is_null(yyjson_obj_iter_get_val(key)))return 0;
    }
    return 1;
}
static int parse_chunk(state *s,const char *data,size_t len) {
    if(len==6 && !memcmp(data,"[DONE]",6)){s->done=1;return 1;}
    yyjson_doc *d=yyjson_read(data,len,0); yyjson_val *root=d?yyjson_doc_get_root(d):NULL,*choices=yyjson_obj_get(root,"choices");int ok=0;
    if(!yyjson_is_obj(root))goto done;
    yyjson_val *upstream_error=yyjson_obj_get(root,"error");
    if(upstream_error) {
        yyjson_val *message=yyjson_obj_get(upstream_error,"message");
        if(yyjson_is_str(message)) {snprintf(s->error_message,sizeof s->error_message,"%.450s",yyjson_get_str(message));s->error=s->error_message;}
        goto done;
    }
    if(!yyjson_is_arr(choices) || yyjson_arr_size(choices)>1 || !usage(s,yyjson_obj_get(root,"usage")))goto done;
    if(!begin(s))goto done;
    if(yyjson_arr_size(choices)) {
        yyjson_val *choice=yyjson_arr_get(choices,0),*delta=yyjson_obj_get(choice,"delta"),*finish=yyjson_obj_get(choice,"finish_reason");
        const char *const delta_fields[]={"role","content","tool_calls","refusal","reasoning_content","function_call","audio",NULL};
        yyjson_val *role=yyjson_obj_get(delta,"role"),*logprobs=yyjson_obj_get(choice,"logprobs");
        if(!known_fields(delta,delta_fields) || (role && !yyjson_is_null(role) && !yyjson_equals_str(role,"assistant")) || (logprobs && !yyjson_is_null(logprobs)) || !finish_reason(s,finish))goto done;
        yyjson_val *legacy=yyjson_obj_get(delta,"function_call"),*audio=yyjson_obj_get(delta,"audio"); if((legacy && !yyjson_is_null(legacy)) || (audio && !yyjson_is_null(audio)))goto done;
        yyjson_val *content=yyjson_obj_get(delta,"content"),*tools=yyjson_obj_get(delta,"tool_calls"),*refusal=yyjson_obj_get(delta,"refusal"),*reason=yyjson_obj_get(delta,"reasoning_content");
        if((refusal && !yyjson_is_null(refusal)) || (reason && !yyjson_is_null(reason)))goto done;
        if(content && !yyjson_is_null(content)) {if(!yyjson_is_str(content) || strlen(yyjson_get_str(content))!=yyjson_get_len(content) || !text_delta(s,yyjson_get_str(content),yyjson_get_len(content)))goto done;}
        if(tools && !yyjson_is_null(tools)){if(!yyjson_is_arr(tools))goto done;size_t i,max;yyjson_val *t;yyjson_arr_foreach(tools,i,max,t)if(!call_delta(s,t))goto done;}
    }
    ok=1;
done: yyjson_doc_free(d);return ok;
}
static int line_received(state *s) {
    char *line=s->line.p; size_t n=s->line.len;
    if(n && line[n-1]=='\r')line[--n]=0;
    if(!n) {
        if(s->event.len) {int ok=parse_chunk(s,s->event.p,s->event.len);s->event.len=0;if(s->event.p)s->event.p[0]=0;if(!ok)return 0;}
    } else if(n>=5 && !memcmp(line,"data:",5)) {
        size_t i=5;if(i<n && line[i]==' ')i++;
        if(s->event.len && !append(&s->event,"\n",1))return 0;
        if(!append(&s->event,line+i,n-i))return 0;
    }
    s->line.len=0;if(s->line.p)s->line.p[0]=0;return 1;
}
static size_t receive(void *ctx,long status,const char *type,const char *data,size_t n) {
    state *s=ctx;
    if(status<200 || status>=300 || !s->streaming) {
        snprintf(s->content_type,sizeof s->content_type,"%s",type);
        if(!append(&s->raw,data,n)){s->error="Upstream response exceeds size limit";return 0;} return n;
    }
    if(strncmp(type,"text/event-stream",17)){s->error="Backend did not return an SSE stream";return 0;}
    if(n>LIMIT || s->raw.len>LIMIT-n){s->error="Upstream stream exceeds size limit";return 0;} s->raw.len+=n; /* byte counter; no raw stream buffering */
    for(size_t i=0;i<n;i++) {
        if(s->done){s->error="Data after upstream stream completion";return 0;}
        if(data[i]=='\n'){if(!line_received(s)){if(!s->error)s->error="Invalid or unsupported upstream streaming event";return 0;}}
        else if(!append(&s->line,data+i,1)){s->error="Upstream SSE event exceeds size limit";return 0;}
    }
    return n;
}
static int nonstream(state *s) {
    yyjson_doc *d=yyjson_read(str(&s->raw),s->raw.len,0); yyjson_val *root=d?yyjson_doc_get_root(d):NULL,*choices=yyjson_obj_get(root,"choices");int ok=0;
    if(!yyjson_is_obj(root) || !yyjson_is_arr(choices) || yyjson_arr_size(choices)!=1 || !usage(s,yyjson_obj_get(root,"usage")))goto done;
    yyjson_val *choice=yyjson_arr_get(choices,0),*message=yyjson_obj_get(choice,"message");
    const char *const message_fields[]={"role","content","tool_calls","refusal","reasoning_content","function_call","audio",NULL};
    yyjson_val *role=yyjson_obj_get(message,"role"),*logprobs=yyjson_obj_get(choice,"logprobs");
    if(!known_fields(message,message_fields) || (role && !yyjson_equals_str(role,"assistant")) || (logprobs && !yyjson_is_null(logprobs)) || !finish_reason(s,yyjson_obj_get(choice,"finish_reason")) || !s->finish)goto done;
    yyjson_val *legacy=yyjson_obj_get(message,"function_call"),*audio=yyjson_obj_get(message,"audio"); if((legacy && !yyjson_is_null(legacy)) || (audio && !yyjson_is_null(audio)))goto done;
    yyjson_val *content=yyjson_obj_get(message,"content"),*refusal=yyjson_obj_get(message,"refusal"),*reason=yyjson_obj_get(message,"reasoning_content"),*calls=yyjson_obj_get(message,"tool_calls");
    if((refusal && !yyjson_is_null(refusal)) || (reason && !yyjson_is_null(reason)))goto done;
    if(content && !yyjson_is_null(content)){if(!yyjson_is_str(content) || strlen(yyjson_get_str(content))!=yyjson_get_len(content))goto done; if(yyjson_get_len(content)){int idx=new_item(s,1,0);if(idx<0 || !append(&s->items[idx].value,yyjson_get_str(content),yyjson_get_len(content)))goto done;}}
    if(calls && !yyjson_is_null(calls)) {
        if(!yyjson_is_arr(calls))goto done;
        size_t i,max;yyjson_val *t;
        yyjson_arr_foreach(calls,i,max,t) {
            yyjson_val *id=yyjson_obj_get(t,"id"),*fn=yyjson_obj_get(t,"function"),*name=yyjson_obj_get(fn,"name"),*args=yyjson_obj_get(fn,"arguments");
            if(!yyjson_equals_str(yyjson_obj_get(t,"type"),"function") || !yyjson_is_str(id) || !yyjson_is_str(name) || !yyjson_is_str(args) || strlen(yyjson_get_str(id))!=yyjson_get_len(id) || strlen(yyjson_get_str(name))!=yyjson_get_len(name) || strlen(yyjson_get_str(args))!=yyjson_get_len(args))goto done;
            int idx=new_item(s,2,(int)i);if(idx<0)goto done;item *it=&s->items[idx];
            if(!yyjson_get_len(id) || !yyjson_get_len(name) || !append(&it->call,yyjson_get_str(id),yyjson_get_len(id)) || !append(&it->name,yyjson_get_str(name),yyjson_get_len(name)) || !append(&it->value,yyjson_get_str(args),yyjson_get_len(args)))goto done;
        }
    }
    ok=1;
done: yyjson_doc_free(d);return ok;
}
static void http_error(int fd,int status,const char *message) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d){reply(fd,500,"application/json","{\"error\":{\"message\":\"Out of memory\"}}");return;}
    yyjson_mut_val *root=yyjson_mut_obj(d),*e=yyjson_mut_obj_add_obj(d,root,"error");yyjson_mut_obj_add_strcpy(d,e,"message",message);yyjson_mut_obj_add_str(d,e,"type",status==400?"invalid_request_error":"upstream_error");yyjson_mut_doc_set_root(d,root);
    char *out=yyjson_mut_write(d,0,NULL);reply(fd,status,"application/json",out?out:"{\"error\":{\"message\":\"Internal error\"}}");free(out);yyjson_mut_doc_free(d);
}
static void stream_error(state *s,const char *message) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL); if(!d)return; yyjson_mut_val *e=yyjson_mut_obj(d);
    yyjson_mut_obj_add_str(d,e,"code","upstream_error");yyjson_mut_obj_add_strcpy(d,e,"message",message);yyjson_mut_obj_add_null(d,e,"param");event_send(s,"error",d,e);
}
static void cleanup(state *s) {free(s->line.p);free(s->event.p);free(s->raw.p);for(size_t i=0;i<s->count;i++){free(s->items[i].name.p);free(s->items[i].call.p);free(s->items[i].value.p);}}
void responses_handle(int fd,const yag_config *c,const char *body,size_t len) {
    response_request request;const char *err=NULL;
    if(!responses_parse(body,len,&request,&err)){http_error(fd,400,err?err:"Invalid request");responses_request_free(&request);return;}
    state s={.fd=fd,.streaming=request.stream,.request=&request,.created=time(NULL)};
    if(!identifier(&s)){http_error(fd,500,"Could not generate a response identifier");goto done;}
    const char *model=yyjson_get_str(yyjson_obj_get(request.root,"model"));
    long status=0;int rc=upstream_for_model(c,model,"/chat/completions",request.chat_json,strlen(request.chat_json),receive,&s,&status,fd);
    if(status>=400 && status<=599 && rc==CURLE_OK) {reply(fd,(int)status,s.content_type[0]?s.content_type:"application/json",s.raw.p?s.raw.p:"");goto done;}
    if(rc!=CURLE_OK || status<200 || status>=300) {
        const char *msg=s.error?s.error:rc==CURLE_OPERATION_TIMEDOUT?"Inference backend timed out":"Inference backend failed or disconnected";
        if(s.sent)stream_error(&s,msg);else http_error(fd,rc==YAG_RESOURCE_BUSY?503:rc==CURLE_OPERATION_TIMEDOUT?504:502,msg);goto done;
    }
    if(s.streaming) {
        if(!s.done || !s.finish || s.line.len || s.event.len || !finish_items(&s)) { if(s.sent)stream_error(&s,"Incomplete or unsupported upstream stream");else http_error(fd,502,"Incomplete or unsupported upstream stream");goto done; }
        response_event(&s,s.finish==2 || s.finish==3?"response.incomplete":"response.completed",1);
    } else {
        if(!nonstream(&s)){http_error(fd,502,"Invalid or unsupported upstream Chat Completions response");goto done;}
        yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d){http_error(fd,500,"Out of memory");goto done;}yyjson_mut_doc_set_root(d,response_json(d,&s,1));char *out=yyjson_mut_write(d,0,NULL);
        if(out)reply(fd,200,"application/json",out);else http_error(fd,500,"Response serialization failed");free(out);yyjson_mut_doc_free(d);
    }
done: cleanup(&s);responses_request_free(&request);
}
