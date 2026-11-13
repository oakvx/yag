#include "yag.h"
#include "yyjson.h"
#include <errno.h>
#include <time.h>
#include <stdlib.h>

/* FIFO admission with a bounded queue. Inference is held through completion
 * of streaming output. A key with several requests cannot bypass earlier
 * queued keys. Limits are optional in the standalone gateway and enabled
 * by the central LAN deployment profile. */
#define MAX_WAITERS 24
struct yag_waiter {
    struct yag_waiter *next;
    int key_index;
};

static int has_capacity(const yag_config *cfg, int key_index) {
    return (!cfg->max_inference ||
             cfg->inference_active < cfg->max_inference)
        && (!cfg->max_per_key ||
             cfg->inference_inflight[key_index] < cfg->max_per_key);
}
static void remove_waiter(yag_config *cfg,struct yag_waiter *who) {
    struct yag_waiter *prev=NULL,*cur=cfg->inference_head;
    while(cur && cur!=who){prev=cur;cur=cur->next;}
    if(!cur)return;
    if(prev)prev->next=cur->next;
    else cfg->inference_head=cur->next;
    if(cfg->inference_tail==cur)cfg->inference_tail=prev;
    cfg->inference_waiting--;
}
int scheduler_acquire(yag_config *cfg,int key_index) {
    if(!cfg->max_inference && !cfg->max_per_key)return 1;
    int ok=0;
    pthread_mutex_lock(&cfg->lock);
    if(!cfg->inference_head && has_capacity(cfg,key_index)) {
        cfg->inference_active++;
        cfg->inference_inflight[key_index]++;
        ok=1;
    } else if(cfg->queue_wait_ms && cfg->inference_waiting<MAX_WAITERS) {
        struct yag_waiter waiter={.next=NULL,.key_index=key_index};
        if(cfg->inference_tail)cfg->inference_tail->next=&waiter;
        else cfg->inference_head=&waiter;
        cfg->inference_tail=&waiter;
        cfg->inference_waiting++;
        struct timespec deadline={0};
        if(!clock_gettime(CLOCK_REALTIME,&deadline)) {
            deadline.tv_sec+=(time_t)(cfg->queue_wait_ms/1000);
            deadline.tv_nsec+=(long)(cfg->queue_wait_ms%1000)*1000000L;
            if(deadline.tv_nsec>=1000000000L) {
                deadline.tv_sec++;
                deadline.tv_nsec-=1000000000L;
            }
            for(;;) {
                if(cfg->inference_head==&waiter && has_capacity(cfg,key_index)) {
                    cfg->inference_active++;
                    cfg->inference_inflight[key_index]++;
                    ok=1;break;
                }
                int rc=pthread_cond_timedwait(&cfg->inference_available,
                                               &cfg->lock,&deadline);
                if(rc==ETIMEDOUT || rc!=0)break;
            }
        }
        remove_waiter(cfg,&waiter);
        pthread_cond_broadcast(&cfg->inference_available);
    }
    pthread_mutex_unlock(&cfg->lock);
    return ok;
}
void scheduler_release(yag_config *cfg,int key_index) {
    if(!cfg->max_inference && !cfg->max_per_key)return;
    pthread_mutex_lock(&cfg->lock);
    if(cfg->inference_inflight[key_index]) {
        cfg->inference_inflight[key_index]--;
        if(cfg->inference_active)cfg->inference_active--;
    }
    pthread_cond_broadcast(&cfg->inference_available);
    pthread_mutex_unlock(&cfg->lock);
}
void scheduler_status(int fd,yag_config *cfg) {
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);
    if(!d) {
        reply(fd,500,"application/json",
            "{\"error\":{\"message\":\"Out of memory\"}}");return;
    }
    yyjson_mut_val *root=yyjson_mut_obj(d);
    int ok=root!=NULL;
    pthread_mutex_lock(&cfg->lock);
    if(ok)ok=yyjson_mut_obj_add_str(d,root,"object","gateway.scheduler")
        && yyjson_mut_obj_add_uint(d,root,"max_inference",cfg->max_inference)
        && yyjson_mut_obj_add_uint(d,root,"max_per_key",cfg->max_per_key)
        && yyjson_mut_obj_add_uint(d,root,"queue_wait_ms",cfg->queue_wait_ms)
        && yyjson_mut_obj_add_uint(d,root,"active",cfg->inference_active)
        && yyjson_mut_obj_add_uint(d,root,"waiting",cfg->inference_waiting);
    pthread_mutex_unlock(&cfg->lock);
    if(ok) yyjson_mut_doc_set_root(d,root);
    char *json=ok?yyjson_mut_write(d,0,NULL):NULL;
    if(json)reply(fd,200,"application/json",json);
    else reply(fd,500,"application/json",
        "{\"error\":{\"message\":\"Could not serialize scheduler status\"}}");
    free(json);yyjson_mut_doc_free(d);
}
