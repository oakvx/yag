#include "yag.h"
#include "yyjson.h"
#include <stdlib.h>
#include <time.h>

/* Snapshot only aggregated in-memory telemetry under the config mutex.
 * Neither provider address nor key, prompt, or client identity is exposed. */
static void stat_json(yyjson_mut_doc *doc,yyjson_mut_val *obj,
        const yag_provider_stats *s,time_t now) {
    int open=s->open_until && (now<s->open_until || s->half_open_probe);
    yyjson_mut_obj_add_uint(doc,obj,"attempts",s->attempts);
    yyjson_mut_obj_add_uint(doc,obj,"successes",s->successes);
    yyjson_mut_obj_add_uint(doc,obj,"failures",s->failures);
    yyjson_mut_obj_add_uint(doc,obj,"bypassed",s->bypassed);
    yyjson_mut_obj_add_uint(doc,obj,"fallbacks",s->fallthroughs);
    yyjson_mut_obj_add_uint(doc,obj,"total_latency_ms",s->latency_ms);
    yyjson_mut_obj_add_uint(doc,obj,"consecutive_failures",s->consecutive_failures);
    yyjson_mut_obj_add_sint(doc,obj,"last_http_status",s->last_http_status);
    yyjson_mut_obj_add_str(doc,obj,"circuit",open?"open":
        s->open_until?"half_open_ready":"closed");
    yyjson_mut_obj_add_sint(doc,obj,"retry_after_seconds",
        open && s->open_until>now?(long)(s->open_until-now):0);
}
void providers_status_handle(int fd,yag_config *cfg) {
    yyjson_mut_doc *doc=yyjson_mut_doc_new(NULL);
    if(!doc) {
        reply(fd,500,"application/json","{\"error\":{\"message\":\"Out of memory\"}}");
        return;
    }
    yyjson_mut_val *root=yyjson_mut_obj(doc);
    yyjson_mut_val *arr=yyjson_mut_obj_add_arr(doc,root,"data");
    yyjson_mut_obj_add_str(doc,root,"object","gateway.providers");
    yyjson_mut_obj_add_uint(doc,root,"circuit_threshold",cfg->circuit_threshold);
    yyjson_mut_obj_add_uint(doc,root,"cooldown_seconds",cfg->circuit_cooldown_seconds);
    pthread_mutex_lock(&cfg->lock);
    time_t now=time(NULL);
    yyjson_mut_val *def=yyjson_mut_obj(doc);
    yyjson_mut_obj_add_str(doc,def,"kind","default");
    yyjson_mut_obj_add_null(doc,def,"model");
    stat_json(doc,def,&cfg->default_provider_stats,now);
    yyjson_mut_arr_add_val(arr,def);
    for(size_t i=0;i<cfg->route_count;i++) {
        yyjson_mut_val *r=yyjson_mut_obj(doc);
        yyjson_mut_obj_add_str(doc,r,"kind","route");
        yyjson_mut_obj_add_strcpy(doc,r,"model",cfg->routes[i].model);
        stat_json(doc,r,&cfg->routes[i].stats,now);
        yyjson_mut_arr_add_val(arr,r);
    }
    pthread_mutex_unlock(&cfg->lock);
    yyjson_mut_doc_set_root(doc,root);
    char *json=yyjson_mut_write(doc,0,NULL);
    if(json)reply(fd,200,"application/json",json);
    else reply(fd,500,"application/json",
        "{\"error\":{\"message\":\"Cannot serialize provider stats\"}}");
    free(json);
    yyjson_mut_doc_free(doc);
}
