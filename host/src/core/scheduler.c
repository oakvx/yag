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

/* A measured budget, not a CUDA-core heuristic. Samples no more than once per
 * second; the configured cap and per-key limits always remain upper bounds.
 * Without supported GPU sensors we retain the configured static cap. */
static void refresh_adaptive_capacity(yag_config *cfg) {
    if(!cfg->adaptive_scheduler || !cfg->max_inference)return;
    time_t now=time(NULL);
    if(now==cfg->adaptive_last_sample)return;
    cfg->adaptive_last_sample=now;
    cfg->adaptive_effective_max=cfg->max_inference;
    cfg->adaptive_sensor_available=0;
    cfg->adaptive_gpu_utilization=0;
    cfg->adaptive_vram_total_bytes=0;
    cfg->adaptive_vram_used_bytes=0;
    yag_gpu_snapshot sample={0};
    if(!gpu_probe_primary(&sample))return;
    cfg->adaptive_gpu_utilization=sample.has_utilization?
        sample.utilization_percent:0;
    if(!sample.has_vram || !sample.vram_total_bytes ||
       sample.vram_used_bytes>sample.vram_total_bytes)return;
    cfg->adaptive_sensor_available=1;
    cfg->adaptive_vram_total_bytes=sample.vram_total_bytes;
    cfg->adaptive_vram_used_bytes=sample.vram_used_bytes;
    unsigned long long free_bytes=sample.vram_total_bytes-sample.vram_used_bytes;
    unsigned long long margin=sample.vram_total_bytes*
        cfg->adaptive_margin_percent/100ULL;
    unsigned long long budget=(unsigned long long)cfg->adaptive_request_vram_mb*1048576ULL;
    unsigned long long slots=(free_bytes>margin)?(free_bytes-margin)/budget:0;
    /* Keep one slot to allow an already-resident model to make progress.
     * Backend OOM protection is still ultimately the model runtime's job. */
    if(!slots)slots=1;
    if(slots>cfg->max_inference)slots=cfg->max_inference;
    if(sample.has_utilization && sample.utilization_percent>=95 && slots>1)
        slots=(slots+1)/2;
    cfg->adaptive_effective_max=(unsigned)slots;
}
static int has_capacity(const yag_config *cfg, int key_index) {
    return (!cfg->max_inference ||
             cfg->inference_active < (cfg->adaptive_scheduler ?
                 cfg->adaptive_effective_max : cfg->max_inference))
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
    refresh_adaptive_capacity(cfg);
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
                refresh_adaptive_capacity(cfg);
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
    refresh_adaptive_capacity(cfg);
    if(ok)ok=yyjson_mut_obj_add_str(d,root,"object","gateway.scheduler")
        && yyjson_mut_obj_add_str(d,root,"admission_mode",
                 cfg->adaptive_scheduler?"adaptive":"static")
        && yyjson_mut_obj_add_bool(d,root,"gpu_sensor_available",
                 cfg->adaptive_sensor_available!=0)
        && yyjson_mut_obj_add_uint(d,root,"effective_max_inference",
                 cfg->adaptive_scheduler?cfg->adaptive_effective_max:cfg->max_inference)
        && yyjson_mut_obj_add_uint(d,root,"gpu_request_vram_mb",
                 cfg->adaptive_request_vram_mb)
        && yyjson_mut_obj_add_uint(d,root,"gpu_margin_percent",
                 cfg->adaptive_margin_percent)
        && yyjson_mut_obj_add_uint(d,root,"gpu_utilization_percent",
                 cfg->adaptive_gpu_utilization)
        && yyjson_mut_obj_add_uint(d,root,"gpu_vram_total_bytes",
                 cfg->adaptive_vram_total_bytes)
        && yyjson_mut_obj_add_uint(d,root,"gpu_vram_used_bytes",
                 cfg->adaptive_vram_used_bytes)
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
