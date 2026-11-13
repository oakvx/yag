#include "yag.h"
#include "yyjson.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Primary admin key is never exposed, rotated or persisted here.
 * Static ENV keys remain in the first slots. Managed keys occupy free slots
 * after them. Management is deliberately limited to 16 extra keys. */
static void failure(int fd,int status,const char *reason) {
    char body[256];
    snprintf(body,sizeof body,"{\"error\":{\"message\":\"%s\"}}",reason);
    reply(fd,status,"application/json",body);
}
static unsigned parse_scope(const char *s) {
    if(!s)return 0;
    if(!strcmp(s,"inference"))return 1;
    if(!strcmp(s,"models"))return 2;
    if(!strcmp(s,"inference+models"))return 3;
    if(!strcmp(s,"monitor"))return 4;
    return 0;
}
static const char *scope_name(unsigned value) {
    switch(value) {
        case 1:return "inference";
        case 2:return "models";
        case 3:return "inference+models";
        case 4:return "monitor";
        case 15:return "all";
        default:return "invalid";
    }
}
static int valid_name(const char *name,size_t len) {
    if(!name || !len || len>48 || strlen(name)!=len)return 0;
    for(size_t i=0;i<len;i++)
        if((unsigned char)name[i]<32 || (unsigned char)name[i]>126
            || name[i]=='<' || name[i]=='>' || name[i]=='"')return 0;
    return 1;
}
static void wipe(char *secret) {
    if(!secret)return;
    volatile unsigned char *p=(volatile unsigned char *)secret;
    size_t len=strlen(secret);
    while(len--)*p++=0;
    free(secret);
}
static int random_key(char result[65]) {
    static const char hex[]="0123456789abcdef";
    unsigned char raw[32];
    int fd=open("/dev/urandom",O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
    if(fd<0)return -1;
    size_t off=0;
    while(off<sizeof raw) {
        ssize_t n=read(fd,raw+off,sizeof raw-off);
        if(n<0 && errno==EINTR)continue;
        if(n<=0){close(fd);return -1;}
        off+=(size_t)n;
    }
    close(fd);
    for(size_t i=0;i<sizeof raw;i++) {
        result[i*2]=hex[raw[i]>>4];
        result[i*2+1]=hex[raw[i]&15];
    }
    result[64]=0;
    volatile unsigned char *p=raw;
    for(size_t i=0;i<sizeof raw;i++)p[i]=0;
    return 0;
}
static int file_is_safe(const char *path) {
    struct stat st;
    if(lstat(path,&st))return errno==ENOENT;
    return S_ISREG(st.st_mode) && !(st.st_mode&0077)
        && st.st_uid==geteuid();
}
/* Called only while holding cfg->lock; failure preserves the old on-disk
 * registry via same-directory atomic rename. No client secrets in logs. */
static int save_locked(const yag_config *cfg) {
    if(!cfg->client_store || !*cfg->client_store)return -1;
    if(!file_is_safe(cfg->client_store))return -1;
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);
    if(!d)return -1;
    yyjson_mut_val *root=yyjson_mut_obj(d);
    yyjson_mut_val *entries=root?yyjson_mut_obj_add_arr(d,root,"entries"):NULL;
    int ok=root && entries
        && yyjson_mut_obj_add_uint(d,root,"version",1);
    for(size_t i=0;ok && i<cfg->extra_key_count;i++) {
        if(!cfg->extra_keys[i])continue;
        yyjson_mut_val *entry=yyjson_mut_obj(d);
        char fallback[24];
        snprintf(fallback,sizeof fallback,"client-%02zu",i+1);
        ok=entry
            && yyjson_mut_obj_add_uint(d,entry,"index",i+1)
            && yyjson_mut_obj_add_bool(d,entry,"managed",cfg->key_managed[i]!=0)
            && yyjson_mut_obj_add_bool(d,entry,"enabled",cfg->key_enabled[i]!=0)
            && yyjson_mut_obj_add_str(d,entry,"scope",scope_name(cfg->extra_key_scopes[i]))
            && yyjson_mut_obj_add_str(d,entry,"name",
                 cfg->key_labels[i]?cfg->key_labels[i]:fallback)
            && (!cfg->key_managed[i]
                || yyjson_mut_obj_add_str(d,entry,"key",cfg->extra_keys[i]))
            && yyjson_mut_arr_add_val(entries,entry);
    }
    if(ok)yyjson_mut_doc_set_root(d,root);
    char *json=ok?yyjson_mut_write(d,0,NULL):NULL;
    yyjson_mut_doc_free(d);
    if(!json)return -1;
    size_t length=strlen(json),n=strlen(cfg->client_store);
    char *temporary=malloc(n+16);
    if(!temporary){free(json);return -1;}
    snprintf(temporary,n+16,"%s.tmp.XXXXXX",cfg->client_store);
    int fd=mkstemp(temporary);
    int saved=-1;
    if(fd>=0) {
        if(!fchmod(fd,0600)) {
            size_t off=0;
            while(off<length) {
                ssize_t written=write(fd,json+off,length-off);
                if(written<0 && errno==EINTR)continue;
                if(written<=0)break;
                off+=(size_t)written;
            }
            if(off==length && !fsync(fd) && !close(fd)) {
                fd=-1;
                if(!rename(temporary,cfg->client_store))saved=0;
            }
        }
        if(fd>=0)close(fd);
    }
    if(saved)unlink(temporary);
    free(temporary);free(json);
    return saved;
}
static int existing_key(const yag_config *cfg,const char *secret) {
    if(!strcmp(secret,cfg->api_key))return 1;
    for(size_t i=0;i<cfg->extra_key_count;i++)
        if(cfg->extra_keys[i] && !strcmp(secret,cfg->extra_keys[i]))return 1;
    return 0;
}
int client_registry_load(yag_config *cfg) {
    if(!cfg->client_store || !*cfg->client_store)return 0;
    if(!file_is_safe(cfg->client_store)) {
        fprintf(stderr,"Invalid private client registry ownership or permissions\n");
        return -1;
    }
    FILE *f=fopen(cfg->client_store,"rb");
    if(!f)return errno==ENOENT?0:-1;
    char *raw=malloc(16385);
    if(!raw){fclose(f);return -1;}
    size_t n=fread(raw,1,16385,f);
    int bad=ferror(f) || n>16384;
    fclose(f);
    if(bad){free(raw);return -1;}
    yyjson_doc *d=yyjson_read(raw,n,0);
    free(raw);
    yyjson_val *root=d?yyjson_doc_get_root(d):NULL;
    yyjson_val *version=yyjson_obj_get(root,"version");
    yyjson_val *entries=yyjson_obj_get(root,"entries");
    int valid=yyjson_is_obj(root) && yyjson_is_uint(version)
        && yyjson_get_uint(version)==1 && yyjson_is_arr(entries)
        && yyjson_arr_size(entries)<=16;
    if(valid) {
        size_t index,total;yyjson_val *entry;
        yyjson_arr_foreach(entries,index,total,entry) {
            yyjson_val *v=yyjson_obj_get(entry,"index"),
                *name=yyjson_obj_get(entry,"name"),
                *scope=yyjson_obj_get(entry,"scope"),
                *enabled=yyjson_obj_get(entry,"enabled"),
                *managed=yyjson_obj_get(entry,"managed"),
                *key=yyjson_obj_get(entry,"key");
            if(!yyjson_is_obj(entry) || !yyjson_is_uint(v)
                || yyjson_get_uint(v)<1 || yyjson_get_uint(v)>16
                || !yyjson_is_str(name) || !yyjson_is_str(scope)
                || (!yyjson_is_true(enabled) && !yyjson_is_false(enabled))
                || (!yyjson_is_true(managed) && !yyjson_is_false(managed))) {
                valid=0;break;
            }
            size_t slot=(size_t)yyjson_get_uint(v)-1;
            if(!valid_name(yyjson_get_str(name),yyjson_get_len(name))
                || (slot<cfg->static_key_count)==yyjson_is_true(managed)
                || (slot>=cfg->static_key_count && cfg->extra_keys[slot])
                || cfg->key_labels[slot]){valid=0;break;}
            unsigned flag=parse_scope(yyjson_get_str(scope));
            if(yyjson_is_true(managed)) {
                if(!flag || !yyjson_is_str(key)
                    || yyjson_get_len(key)<32 || yyjson_get_len(key)>128
                    || strlen(yyjson_get_str(key))!=yyjson_get_len(key)
                    || existing_key(cfg,yyjson_get_str(key))) {valid=0;break;}
                char *copy=strdup(yyjson_get_str(key));
                if(!copy){valid=0;break;}
                cfg->managed_key_secrets[slot]=copy;
                cfg->extra_keys[slot]=copy;
                cfg->extra_key_scopes[slot]=flag;
                cfg->key_managed[slot]=1;
                if(cfg->extra_key_count<=slot)cfg->extra_key_count=slot+1;
            } else {
                if(flag!=cfg->extra_key_scopes[slot] || key
                    || !cfg->extra_keys[slot]){valid=0;break;}
            }
            cfg->key_enabled[slot]=yyjson_is_true(enabled);
            cfg->key_labels[slot]=strdup(yyjson_get_str(name));
            if(!cfg->key_labels[slot]){valid=0;break;}
        }
    }
    yyjson_doc_free(d);
    if(!valid)fprintf(stderr,"Invalid private client registry format or credentials\n");
    return valid?0:-1;
}
void client_registry_free(yag_config *cfg) {
    for(size_t i=0;i<16;i++) {
        wipe(cfg->managed_key_secrets[i]);
        cfg->managed_key_secrets[i]=NULL;
        free(cfg->key_labels[i]);cfg->key_labels[i]=NULL;
    }
}
static int serialize_list(int fd,yag_config *cfg) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);
    if(!d){failure(fd,500,"Out of memory");return 1;}
    yyjson_mut_val *root=yyjson_mut_obj(d);
    yyjson_mut_val *items=root?yyjson_mut_obj_add_arr(d,root,"data"):NULL;
    int ok=root && items && yyjson_mut_obj_add_str(d,root,"object","gateway.clients");
    pthread_mutex_lock(&cfg->lock);
    for(size_t i=0;ok && i<cfg->extra_key_count;i++) {
        if(!cfg->extra_keys[i])continue;
        yyjson_mut_val *item=yyjson_mut_obj(d);
        char fallback[24];
        snprintf(fallback,sizeof fallback,"client-%02zu",i+1);
        ok=item
            && yyjson_mut_obj_add_uint(d,item,"id",i+1)
            && yyjson_mut_obj_add_str(d,item,"name",cfg->key_labels[i]?
               cfg->key_labels[i]:fallback)
            && yyjson_mut_obj_add_str(d,item,"scope",
               scope_name(cfg->extra_key_scopes[i]))
            && yyjson_mut_obj_add_bool(d,item,"enabled",cfg->key_enabled[i]!=0)
            && yyjson_mut_obj_add_bool(d,item,"managed",cfg->key_managed[i]!=0)
            && yyjson_mut_obj_add_uint(d,item,"accepted_requests",
                cfg->key_accepted_requests[i+1])
            && yyjson_mut_obj_add_uint(d,item,"rate_limited_requests",
                cfg->key_rate_limited_requests[i+1])
            && yyjson_mut_arr_add_val(items,item);
    }
    pthread_mutex_unlock(&cfg->lock);
    if(ok)yyjson_mut_doc_set_root(d,root);
    char *json=ok?yyjson_mut_write(d,0,NULL):NULL;
    if(json)reply(fd,200,"application/json",json);
    else failure(fd,500,"Could not serialize clients");
    free(json);yyjson_mut_doc_free(d);
    return 1;
}
static int valid_id(yyjson_val *root,size_t *slot) {
    yyjson_val *id=yyjson_obj_get(root,"id");
    if(!yyjson_is_uint(id) || yyjson_get_uint(id)<1
        || yyjson_get_uint(id)>16)return 0;
    *slot=(size_t)yyjson_get_uint(id)-1;
    return 1;
}
int client_registry_handle(int fd,yag_config *cfg,const char *method,
        const char *uri,const char *body,size_t length) {
    if(strncmp(uri,"/api/admin/clients",18))return 0;
    if(strcmp(uri,"/api/admin/clients") && strcmp(uri,"/api/admin/clients/enable")
        && strcmp(uri,"/api/admin/clients/disable")
        && strcmp(uri,"/api/admin/clients/revoke")
        && strcmp(uri,"/api/admin/clients/rename"))return 0;
    if(!cfg->client_store || !*cfg->client_store) {
        failure(fd,503,"Runtime client management is not enabled");
        return 1;
    }
    if(!strcmp(uri,"/api/admin/clients") && !strcmp(method,"GET"))
        return serialize_list(fd,cfg);
    if(strcmp(method,"POST")) {failure(fd,405,"Method not allowed");return 1;}
    yyjson_doc *d=yyjson_read(body,length,0);
    yyjson_val *root=d?yyjson_doc_get_root(d):NULL;
    if(!yyjson_is_obj(root)){yyjson_doc_free(d);failure(fd,400,"Expected JSON object");return 1;}
    if(!strcmp(uri,"/api/admin/clients")) {
        yyjson_val *name=yyjson_obj_get(root,"name");
        yyjson_val *scope=yyjson_obj_get(root,"scope");
        if(yyjson_obj_size(root)!=2 || !yyjson_is_str(name) || !yyjson_is_str(scope)
            || !valid_name(yyjson_get_str(name),yyjson_get_len(name))
            || !parse_scope(yyjson_get_str(scope))) {
            failure(fd,400,"Expected valid client name and scope");
            yyjson_doc_free(d);return 1;
        }
        char token[65];
        if(random_key(token)) {
            failure(fd,503,"Secure random generation unavailable");
            yyjson_doc_free(d);return 1;
        }
        char *label=strdup(yyjson_get_str(name));
        char *secret=strdup(token);
        if(!label || !secret) {
            free(label);wipe(secret);
            failure(fd,500,"Out of memory");
            yyjson_doc_free(d);return 1;
        }
        int saved=-1;
        size_t slot=16;
        pthread_mutex_lock(&cfg->lock);
        for(size_t i=cfg->static_key_count;i<16;i++)
            if(!cfg->extra_keys[i] && !cfg->inference_inflight[i+1]) {
                slot=i;break;
            }
        if(slot<16 && !existing_key(cfg,secret)) {
            size_t old_count=cfg->extra_key_count;
            char *old_label=cfg->key_labels[slot];
            unsigned old_scope=cfg->extra_key_scopes[slot];
            cfg->extra_keys[slot]=secret;
            cfg->managed_key_secrets[slot]=secret;
            cfg->key_labels[slot]=label;
            cfg->key_managed[slot]=1;
            cfg->key_enabled[slot]=1;
            cfg->extra_key_scopes[slot]=parse_scope(yyjson_get_str(scope));
            if(cfg->extra_key_count<=slot)cfg->extra_key_count=slot+1;
            saved=save_locked(cfg);
            if(saved) {
                cfg->extra_keys[slot]=NULL;
                cfg->managed_key_secrets[slot]=NULL;
                cfg->key_labels[slot]=old_label;
                cfg->key_managed[slot]=0;
                cfg->key_enabled[slot]=0;
                cfg->extra_key_scopes[slot]=old_scope;
                cfg->extra_key_count=old_count;
            } else free(old_label);
        }
        pthread_mutex_unlock(&cfg->lock);
        if(saved) {
            free(label);wipe(secret);
            failure(fd,slot==16?409:503,
                slot==16?"Maximum client count reached":"Client registry could not be saved");
        } else {
            char response[160];
            int n=snprintf(response,sizeof response,
                "{\"id\":%zu,\"api_key\":\"%s\",\"enabled\":true}",slot+1,token);
            if(n>0 && (size_t)n<sizeof response)
                reply(fd,201,"application/json",response);
            else failure(fd,500,"Could not encode client key");
        }
    } else {
        size_t slot=16;
        if(!valid_id(root,&slot)) {
            failure(fd,400,"Expected client id from 1 to 16");
            yyjson_doc_free(d);return 1;
        }
        int rename_action=!strcmp(uri,"/api/admin/clients/rename");
        yyjson_val *name=yyjson_obj_get(root,"name");
        if(yyjson_obj_size(root)!=(size_t)(rename_action?2:1)
            || (rename_action && (!yyjson_is_str(name)
                || !valid_name(yyjson_get_str(name),yyjson_get_len(name))))) {
            failure(fd,400,"Invalid client action");
            yyjson_doc_free(d);return 1;
        }
        char *new_name=rename_action?strdup(yyjson_get_str(name)):NULL;
        if(rename_action && !new_name){
            failure(fd,500,"Out of memory");yyjson_doc_free(d);return 1;
        }
        int saved=-1,missing=0;
        char *old_label=NULL,*old_secret=NULL;
        unsigned char old_enabled=0,old_managed=0;
        pthread_mutex_lock(&cfg->lock);
        if(slot>=cfg->extra_key_count || !cfg->extra_keys[slot])missing=1;
        else {
            old_label=cfg->key_labels[slot];
            old_enabled=cfg->key_enabled[slot];
            old_managed=cfg->key_managed[slot];
            if(rename_action)cfg->key_labels[slot]=new_name;
            else if(!strcmp(uri,"/api/admin/clients/enable"))
                cfg->key_enabled[slot]=1;
            else if(!strcmp(uri,"/api/admin/clients/disable"))
                cfg->key_enabled[slot]=0;
            else if(old_managed) {
                old_secret=cfg->managed_key_secrets[slot];
                cfg->managed_key_secrets[slot]=NULL;
                cfg->extra_keys[slot]=NULL;
                cfg->key_managed[slot]=0;
                cfg->key_enabled[slot]=0;
                cfg->key_labels[slot]=NULL;
            } else cfg->key_enabled[slot]=0; /* static keys can only be disabled */
            saved=save_locked(cfg);
            if(saved) {
                cfg->key_enabled[slot]=old_enabled;
                cfg->key_managed[slot]=old_managed;
                cfg->key_labels[slot]=old_label;
                if(old_secret) {
                    cfg->managed_key_secrets[slot]=old_secret;
                    cfg->extra_keys[slot]=old_secret;
                }
            }
        }
        pthread_mutex_unlock(&cfg->lock);
        if(missing)failure(fd,404,"Client not found");
        else if(saved)failure(fd,503,"Client registry could not be saved");
        else {
            if(rename_action)free(old_label);
            else if(old_secret){free(old_label);wipe(old_secret);}
            reply(fd,200,"application/json","{\"ok\":true}");
        }
        if(!rename_action || saved || missing)free(new_name);
    }
    yyjson_doc_free(d);
    return 1;
}
