#include "yag.h"
#include "yyjson.h"
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_SSE_BYTES (4*1024*1024)
#define MAX_TOOLS 32
typedef struct { char *p; size_t n, cap; } buffer;
typedef struct { buffer id, name, arguments; int used; } tool;
typedef struct {
    int fd, sent, failed, done, finished, text_open, text_seen;
    int finish_reason, block_index;
    long input_tokens, output_tokens;
    size_t received;
    char message_id[37];
    const char *model;
    buffer line, data;
    tool tools[MAX_TOOLS];
} stream;

static const char *valstr(yyjson_val *v) {
    if(!yyjson_is_str(v))return NULL;
    const char *p=yyjson_get_str(v);
    return p && strlen(p)==yyjson_get_len(v)?p:NULL;
}
static int append(buffer *b,const char *data,size_t n) {
    if(n>MAX_SSE_BYTES || b->n>MAX_SSE_BYTES-n)return 0;
    if(n+1>SIZE_MAX-b->n)return 0;
    size_t wanted=b->n+n+1;
    if(wanted>b->cap) {
        size_t cap=b->cap?b->cap:128;
        while(cap<wanted)cap=(cap>MAX_SSE_BYTES/2)?MAX_SSE_BYTES+1:cap*2;
        char *p=realloc(b->p,cap);if(!p)return 0;
        b->p=p;b->cap=cap;
    }
    memcpy(b->p+b->n,data,n);
    b->n+=n;b->p[b->n]=0;
    return 1;
}
static void reset(buffer *b) {b->n=0;if(b->p)b->p[0]=0;}
static int emit(stream *s,const char *name,yyjson_mut_doc *doc,yyjson_mut_val *obj) {
    int ok=0;
    if(obj && yyjson_mut_obj_add_str(doc,obj,"type",name)) {
        yyjson_mut_doc_set_root(doc,obj);
        char *json=yyjson_mut_write(doc,0,NULL);
        if(json) {
            char head[128];
            int n=snprintf(head,sizeof head,"event: %s\ndata: ",name);
            ok=n>0 && (size_t)n<sizeof head
                && send_all(s->fd,head,(size_t)n)==0
                && send_all(s->fd,json,strlen(json))==0
                && send_all(s->fd,"\n\n",2)==0;
            free(json);
        }
    }
    yyjson_mut_doc_free(doc);
    if(!ok)s->failed=1;
    return ok;
}
static int begin_message(stream *s) {
    if(s->sent)return 1;
    static const char header[]="HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n";
    if(send_all(s->fd,header,sizeof header-1)){s->failed=1;return 0;}
    s->sent=1;
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);
    if(!d)return 0;
    yyjson_mut_val *o=yyjson_mut_obj(d),*m=yyjson_mut_obj_add_obj(d,o,"message");
    yyjson_mut_obj_add_strcpy(d,m,"id",s->message_id);
    yyjson_mut_obj_add_str(d,m,"type","message");
    yyjson_mut_obj_add_str(d,m,"role","assistant");
    yyjson_mut_obj_add_strcpy(d,m,"model",s->model);
    yyjson_mut_obj_add_arr(d,m,"content");
    yyjson_mut_obj_add_null(d,m,"stop_reason");
    yyjson_mut_obj_add_null(d,m,"stop_sequence");
    yyjson_mut_val *usage=yyjson_mut_obj_add_obj(d,m,"usage");
    yyjson_mut_obj_add_sint(d,usage,"input_tokens",0);
    yyjson_mut_obj_add_sint(d,usage,"output_tokens",0);
    return emit(s,"message_start",d,o);
}
static int start_text(stream *s) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d)return 0;
    yyjson_mut_val *o=yyjson_mut_obj(d);
    yyjson_mut_obj_add_int(d,o,"index",s->block_index);
    yyjson_mut_val *part=yyjson_mut_obj_add_obj(d,o,"content_block");
    yyjson_mut_obj_add_str(d,part,"type","text");
    yyjson_mut_obj_add_str(d,part,"text","");
    return emit(s,"content_block_start",d,o);
}
static int text_delta(stream *s,const char *text) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d)return 0;
    yyjson_mut_val *o=yyjson_mut_obj(d);
    yyjson_mut_obj_add_int(d,o,"index",s->block_index);
    yyjson_mut_val *delta=yyjson_mut_obj_add_obj(d,o,"delta");
    yyjson_mut_obj_add_str(d,delta,"type","text_delta");
    yyjson_mut_obj_add_strcpy(d,delta,"text",text);
    return emit(s,"content_block_delta",d,o);
}
static int block_stop(stream *s) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d)return 0;
    yyjson_mut_val *o=yyjson_mut_obj(d);
    yyjson_mut_obj_add_int(d,o,"index",s->block_index++);
    return emit(s,"content_block_stop",d,o);
}
static int tool_start(stream *s,tool *t) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d)return 0;
    yyjson_mut_val *o=yyjson_mut_obj(d);
    yyjson_mut_obj_add_int(d,o,"index",s->block_index);
    yyjson_mut_val *part=yyjson_mut_obj_add_obj(d,o,"content_block");
    yyjson_mut_obj_add_str(d,part,"type","tool_use");
    yyjson_mut_obj_add_strcpy(d,part,"id",t->id.p);
    yyjson_mut_obj_add_strcpy(d,part,"name",t->name.p);
    yyjson_mut_obj_add_obj(d,part,"input");
    return emit(s,"content_block_start",d,o);
}
static int tool_delta(stream *s,tool *t) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d)return 0;
    yyjson_mut_val *o=yyjson_mut_obj(d);
    yyjson_mut_obj_add_int(d,o,"index",s->block_index);
    yyjson_mut_val *delta=yyjson_mut_obj_add_obj(d,o,"delta");
    yyjson_mut_obj_add_str(d,delta,"type","input_json_delta");
    yyjson_mut_obj_add_strcpy(d,delta,"partial_json",t->arguments.p?t->arguments.p:"{}");
    return emit(s,"content_block_delta",d,o);
}
static int finish_message(stream *s) {
    if(s->text_open) {
        if(!block_stop(s))return 0;
        s->text_open=0;
    }
    int tools=0;
    for(int i=0;i<MAX_TOOLS;i++)if(s->tools[i].used) {
        tool *t=&s->tools[i];
        if(!t->id.n || !t->name.n || !t->arguments.n)return 0;
        yyjson_doc *parsed=yyjson_read(t->arguments.p,t->arguments.n,0);
        int valid=parsed && yyjson_is_obj(yyjson_doc_get_root(parsed));
        yyjson_doc_free(parsed);
        if(!valid)return 0;
        if(!tool_start(s,t) || !tool_delta(s,t) || !block_stop(s))return 0;
        tools++;
    }
    const char *stop=tools?"tool_use":s->finish_reason==2?"max_tokens":"end_turn";
    if(!tools && s->finish_reason==3)return 0;
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d)return 0;
    yyjson_mut_val *o=yyjson_mut_obj(d),*delta=yyjson_mut_obj_add_obj(d,o,"delta");
    yyjson_mut_obj_add_str(d,delta,"stop_reason",stop);
    yyjson_mut_obj_add_null(d,delta,"stop_sequence");
    yyjson_mut_val *usage=yyjson_mut_obj_add_obj(d,o,"usage");
    yyjson_mut_obj_add_sint(d,usage,"output_tokens",s->output_tokens);
    if(!emit(s,"message_delta",d,o))return 0;
    d=yyjson_mut_doc_new(NULL);if(!d)return 0;
    o=yyjson_mut_obj(d);
    return emit(s,"message_stop",d,o);
}
static int process_event(stream *s) {
    if(!s->data.n)return 1;
    if(!strcmp(s->data.p,"[DONE]")) {
        if(s->done || !s->finished)return 0;
        s->done=1;
        return finish_message(s);
    }
    yyjson_doc *doc=yyjson_read(s->data.p,s->data.n,0);
    yyjson_val *root=doc?yyjson_doc_get_root(doc):NULL;
    yyjson_val *choices=yyjson_obj_get(root,"choices");
    int ok=0;
    if(!yyjson_is_obj(root) || yyjson_obj_get(root,"error"))goto end;
    yyjson_val *usage=yyjson_obj_get(root,"usage");
    if(usage && !yyjson_is_null(usage)) {
        yyjson_val *in=yyjson_obj_get(usage,"prompt_tokens"),*out=yyjson_obj_get(usage,"completion_tokens");
        if(!yyjson_is_int(in) || !yyjson_is_int(out) || yyjson_get_sint(in)<0 || yyjson_get_sint(out)<0)goto end;
        s->input_tokens=(long)yyjson_get_sint(in);
        s->output_tokens=(long)yyjson_get_sint(out);
    }
    if(!yyjson_is_arr(choices) || yyjson_arr_size(choices)>1)goto end;
    if(!yyjson_arr_size(choices)){ok=1;goto end;}
    yyjson_val *choice=yyjson_arr_get(choices,0),*delta=yyjson_obj_get(choice,"delta");
    if(!yyjson_is_obj(delta))goto end;
    yyjson_val *role=yyjson_obj_get(delta,"role"),*content=yyjson_obj_get(delta,"content");
    if(role && !yyjson_is_null(role) && !yyjson_equals_str(role,"assistant"))goto end;
    if(content && !yyjson_is_null(content)) {
        const char *text=valstr(content);
        if(!text || s->finished)return 0;
        if(*text) {
            for(int i=0;i<MAX_TOOLS;i++)if(s->tools[i].used)goto end;
            if(!s->text_open) {
                if(!start_text(s))goto end;
                s->text_open=1;
                s->text_seen=1;
            }
            if(!text_delta(s,text))goto end;
        }
    }
    yyjson_val *calls=yyjson_obj_get(delta,"tool_calls");
    if(calls && !yyjson_is_null(calls)) {
        if(!yyjson_is_arr(calls) || s->finished)goto end;
        size_t i,n;yyjson_val *call;
        yyjson_arr_foreach(calls,i,n,call) {
            yyjson_val *idx=yyjson_obj_get(call,"index");
            if(!yyjson_is_int(idx) || yyjson_get_sint(idx)<0 || yyjson_get_sint(idx)>=MAX_TOOLS)goto end;
            int j=(int)yyjson_get_sint(idx);
            tool *t=&s->tools[j];t->used=1;
            yyjson_val *id=yyjson_obj_get(call,"id"),*fn=yyjson_obj_get(call,"function");
            yyjson_val *type=yyjson_obj_get(call,"type");
            if(type && !yyjson_is_null(type) && !yyjson_equals_str(type,"function"))goto end;
            if(id && (!valstr(id) || !append(&t->id,yyjson_get_str(id),yyjson_get_len(id))))goto end;
            if(fn) {
                yyjson_val *name=yyjson_obj_get(fn,"name"),*args=yyjson_obj_get(fn,"arguments");
                if(name && (!valstr(name) || !append(&t->name,yyjson_get_str(name),yyjson_get_len(name))))goto end;
                if(args && (!valstr(args) || !append(&t->arguments,yyjson_get_str(args),yyjson_get_len(args))))goto end;
            }
        }
    }
    yyjson_val *finish=yyjson_obj_get(choice,"finish_reason");
    if(finish && !yyjson_is_null(finish)) {
        if(yyjson_equals_str(finish,"stop"))s->finish_reason=1;
        else if(yyjson_equals_str(finish,"length"))s->finish_reason=2;
        else if(yyjson_equals_str(finish,"tool_calls"))s->finish_reason=3;
        else goto end;
        s->finished=1;
    }
    ok=1;
end:
    yyjson_doc_free(doc);
    return ok;
}
static int line_received(stream *s) {
    size_t n=s->line.n;
    if(n && s->line.p[n-1]=='\r')s->line.p[--n]=0;
    int ok=1;
    if(!n) {
        ok=process_event(s);
        reset(&s->data);
    } else if(n>=5 && !memcmp(s->line.p,"data:",5)) {
        const char *p=s->line.p+5;if(*p==' ')p++;
        if(s->data.n && !append(&s->data,"\n",1))ok=0;
        else if(!append(&s->data,p,strlen(p)))ok=0;
    }
    reset(&s->line);
    return ok;
}
static size_t receive(void *context,long status,const char *content_type,const char *bytes,size_t len) {
    stream *s=context;
    if(status<200 || status>=300)return len;
    if(strncmp(content_type,"text/event-stream",17))return 0;
    if(!begin_message(s))return 0;
    if(len>MAX_SSE_BYTES || s->received>MAX_SSE_BYTES-len)return 0;
    s->received+=len;
    for(size_t i=0;i<len;i++) {
        if(s->done)return 0;
        if(bytes[i]=='\n') {
            if(!line_received(s))return 0;
        } else if(!append(&s->line,bytes+i,1))return 0;
    }
    return len;
}
static void streaming_error(stream *s,const char *message) {
    if(!s->sent)return;
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);if(!d)return;
    yyjson_mut_val *o=yyjson_mut_obj(d),*error=yyjson_mut_obj_add_obj(d,o,"error");
    yyjson_mut_obj_add_str(d,error,"type","api_error");
    yyjson_mut_obj_add_strcpy(d,error,"message",message);
    emit(s,"error",d,o);
}
void anthropic_stream_handle(int fd,const yag_config *cfg,const char *model,const char *request) {
    stream *s=calloc(1,sizeof *s);
    if(!s){reply(fd,500,"application/json","{\"error\":{\"message\":\"Out of memory\"}}");return;}
    s->fd=fd;s->model=model;
    unsigned char entropy[16];FILE *f=fopen("/dev/urandom","rb");
    int ok=f && fread(entropy,1,sizeof entropy,f)==sizeof entropy;
    if(f)fclose(f);
    if(!ok){reply(fd,500,"application/json","{\"error\":{\"message\":\"Cannot generate message ID\"}}");goto done;}
    memcpy(s->message_id,"msg_",4);
    for(int i=0;i<16;i++)snprintf(s->message_id+4+i*2,3,"%02x",entropy[i]);
    long status=0;
    int rc=upstream_for_model(cfg,model,"/chat/completions",request,strlen(request),
        receive,s,&status,fd);
    if(rc!=CURLE_OK || status<200 || status>=300 || !s->done
        || s->line.n || s->data.n || s->failed) {
        if(s->sent)streaming_error(s,"Upstream stream failed or ended before completion");
        else reply(fd,rc==YAG_RESOURCE_BUSY?503:rc==CURLE_OPERATION_TIMEDOUT?504:status==429?429:502,
            "application/json","{\"error\":{\"message\":\"Inference stream unavailable\"}}");
    }
done:
    free(s->line.p);free(s->data.p);
    for(int i=0;i<MAX_TOOLS;i++) {
        free(s->tools[i].id.p);free(s->tools[i].name.p);
        free(s->tools[i].arguments.p);
    }
    free(s);
}
