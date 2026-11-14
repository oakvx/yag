#include "yag.h"
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Optional runtime probes: no hard dependency on CUDA, NVML or a vendor SDK.
 * The NVIDIA driver injects libnvidia-ml.so.1 in a GPU-enabled container.
 * All paths and symbol names are constant, never supplied by an HTTP client. */
typedef struct { unsigned long long total,free,used; } nvml_memory;
typedef struct { unsigned gpu,memory; } nvml_utilization;
typedef int (*nvml_init_fn)(void);
typedef int (*nvml_shutdown_fn)(void);
typedef int (*nvml_handle_fn)(unsigned,void **);
typedef int (*nvml_memory_fn)(void *,nvml_memory *);
typedef int (*nvml_util_fn)(void *,nvml_utilization *);
static pthread_mutex_t nvml_lock=PTHREAD_MUTEX_INITIALIZER;

static int try_nvml(yag_gpu_snapshot *out) {
    int available=0;
    pthread_mutex_lock(&nvml_lock);
    void *library=dlopen("libnvidia-ml.so.1",RTLD_NOW|RTLD_LOCAL);
    if(!library)goto done;
    nvml_init_fn init=NULL;
    nvml_shutdown_fn shutdown=NULL;
    nvml_handle_fn get_handle=NULL;
    nvml_memory_fn get_memory=NULL;
    nvml_util_fn get_util=NULL;
    *(void **)(&init)=dlsym(library,"nvmlInit_v2");
    *(void **)(&shutdown)=dlsym(library,"nvmlShutdown");
    *(void **)(&get_handle)=dlsym(library,"nvmlDeviceGetHandleByIndex_v2");
    *(void **)(&get_memory)=dlsym(library,"nvmlDeviceGetMemoryInfo");
    *(void **)(&get_util)=dlsym(library,"nvmlDeviceGetUtilizationRates");
    if(init && shutdown && get_handle && get_memory && !init()) {
        void *device=NULL;
        if(!get_handle(0,&device) && device) {
            nvml_memory memory={0};
            if(!get_memory(device,&memory) && memory.total &&
               memory.used<=memory.total) {
                out->vram_total_bytes=memory.total;
                out->vram_used_bytes=memory.used;
                out->has_vram=1;
                available=1;
            }
            nvml_utilization util={0};
            if(get_util && !get_util(device,&util) && util.gpu<=100) {
                out->utilization_percent=util.gpu;
                out->has_utilization=1;
                available=1;
            }
            if(available)out->source="nvml_primary_device";
        }
        shutdown();
    }
    dlclose(library);
done:
    pthread_mutex_unlock(&nvml_lock);
    return available;
}
static int read_counter(const char *path,unsigned long long *out) {
    FILE *file=fopen(path,"r");
    if(!file)return 0;
    char buf[64]={0};
    int ok=fgets(buf,sizeof buf,file)!=NULL;
    fclose(file);
    if(!ok)return 0;
    char *end=NULL;
    errno=0;
    unsigned long long value=strtoull(buf,&end,10);
    if(errno || end==buf || (*end && *end!='\n'))return 0;
    *out=value;
    return 1;
}
static int try_drm(yag_gpu_snapshot *out) {
    for(unsigned i=0;i<16;i++) {
        char path[160];
        unsigned long long busy=0,total=0,used=0;
        snprintf(path,sizeof path,"/sys/class/drm/card%u/device/gpu_busy_percent",i);
        int has_busy=read_counter(path,&busy) && busy<=100;
        snprintf(path,sizeof path,"/sys/class/drm/card%u/device/mem_info_vram_total",i);
        int has_total=read_counter(path,&total) && total>0;
        snprintf(path,sizeof path,"/sys/class/drm/card%u/device/mem_info_vram_used",i);
        int has_used=read_counter(path,&used);
        if(!has_busy && !(has_total && has_used && used<=total))continue;
        out->source="linux_drm_sysfs_primary";
        if(has_total && has_used && used<=total) {
            out->has_vram=1;
            out->vram_total_bytes=total;
            out->vram_used_bytes=used;
        }
        if(has_busy) {
            out->has_utilization=1;
            out->utilization_percent=(unsigned)busy;
        }
        return 1;
    }
    return 0;
}
int gpu_probe_primary(yag_gpu_snapshot *out) {
    if(!out)return 0;
    memset(out,0,sizeof *out);
    return try_nvml(out) || try_drm(out);
}
