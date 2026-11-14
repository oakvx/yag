#include "yag.h"
#include "yyjson.h"
#include <errno.h>
#include <dirent.h>
#include <ctype.h>
#include <time.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Container-scoped cgroup values. Never misrepresent these as host-wide
 * RAM/VRAM utilization. Files may be absent on non-Linux systems. */
static int read_counter(const char *path,unsigned long long *value) {
    FILE *file=fopen(path,"r");
    if(!file)return 0;
    char text[64]={0};
    int ok=fgets(text,sizeof text,file)!=NULL;
    fclose(file);
    if(!ok || !strcmp(text,"max\n") || !strcmp(text,"max"))return 0;
    char *end=NULL;
    errno=0;
    unsigned long long n=strtoull(text,&end,10);
    if(errno || end==text || (*end && *end!='\n'))return 0;
    *value=n;
    return 1;
}
static int read_load(double *a,double *b,double *c) {
    FILE *file=fopen("/proc/loadavg","r");
    if(!file)return 0;
    int ok=fscanf(file,"%lf %lf %lf",a,b,c)==3;
    fclose(file);
    return ok;
}

/* /proc/meminfo reports memory visible to the Linux kernel, which can be the
 * entire host even when YAG runs in a container. Keep it separate from cgroup
 * memory and label its origin instead of calling it container memory. */
static int read_visible_memory(unsigned long long *total,unsigned long long *free_mem) {
    FILE *f=fopen("/proc/meminfo","r");
    if(!f)return 0;
    char line[160];
    int have_total=0,have_available=0;
    while(fgets(line,sizeof line,f)) {
        if(sscanf(line,"MemTotal: %llu kB",total)==1)have_total=1;
        if(sscanf(line,"MemAvailable: %llu kB",free_mem)==1)have_available=1;
        if(have_total && have_available)break;
    }
    fclose(f);
    if(!have_total || !have_available || *free_mem>*total
        || *total>18446744073709551ULL)return 0;
    *total*=1024ULL;
    *free_mem*=1024ULL;
    return 1;
}

/* Report a utilization sample only after two successive /proc/stat reads;
 * a since-boot average is NOT a current CPU utilization percentage. */
static pthread_mutex_t cpu_sample_lock=PTHREAD_MUTEX_INITIALIZER;
static unsigned long long cpu_prev_total=0,cpu_prev_idle=0;
static int read_cpu_utilization(double *percent) {
    FILE *f=fopen("/proc/stat","r");
    if(!f)return 0;
    unsigned long long user=0,nice=0,system=0,idle=0,iowait=0,irq=0,softirq=0,steal=0;
    int parsed=fscanf(f,"cpu %llu %llu %llu %llu %llu %llu %llu %llu",
                      &user,&nice,&system,&idle,&iowait,&irq,&softirq,&steal);
    fclose(f);
    if(parsed!=8)return 0;
    unsigned long long total=user+nice+system+idle+iowait+irq+softirq+steal;
    unsigned long long quiet=idle+iowait;
    int valid=0;
    pthread_mutex_lock(&cpu_sample_lock);
    if(cpu_prev_total && total>cpu_prev_total
       && quiet>=cpu_prev_idle && quiet-cpu_prev_idle<=total-cpu_prev_total) {
        *percent=100.0*(1.0-(double)(quiet-cpu_prev_idle)/(double)(total-cpu_prev_total));
        valid=1;
    }
    cpu_prev_total=total;
    cpu_prev_idle=quiet;
    pthread_mutex_unlock(&cpu_sample_lock);
    return valid;
}

/* Only read documented Linux DRM/sysfs counters. Drivers such as NVIDIA
 * often do not expose these files; absence is 'unavailable', not 0% usage.
 * Paths are fixed kernel locations, never influenced by request input. */
static int gpu_temperature(unsigned index,unsigned long long *millidegrees) {
    char dirpath[160];
    snprintf(dirpath,sizeof dirpath,"/sys/class/drm/card%u/device/hwmon",index);
    DIR *dir=opendir(dirpath);
    if(!dir)return 0;
    int ok=0;
    struct dirent *entry;
    while((entry=readdir(dir))) {
        if(strncmp(entry->d_name,"hwmon",5))continue;
        const char *p=entry->d_name+5;
        if(!*p)continue;
        for(;*p && isdigit((unsigned char)*p);p++);
        if(*p)continue;
        char path[256];
        int n=snprintf(path,sizeof path,"%s/%s/temp1_input",dirpath,entry->d_name);
        if(n>0 && (size_t)n<sizeof path && read_counter(path,millidegrees)) {
            ok=1;break;
        }
    }
    closedir(dir);
    return ok;
}
static int add_gpu_sysfs(yyjson_mut_doc *d,yyjson_mut_val *gpu,int *count) {
    yyjson_mut_val *devices=yyjson_mut_obj_add_arr(d,gpu,"devices");
    if(!devices)return 0;
    *count=0;
    /* Prefer the full NVIDIA NVML reading over a temperature-only DRM
     * entry for the same GPU; never publish duplicate device cards. */
    yag_gpu_snapshot primary={0};
    if(gpu_probe_primary(&primary) && primary.source &&
       !strcmp(primary.source,"nvml_primary_device")) {
        yyjson_mut_val *device=yyjson_mut_obj(d);
        int ok=device && yyjson_mut_obj_add_str(d,device,"id","gpu0");
        if(ok && primary.has_utilization)
            ok=yyjson_mut_obj_add_uint(d,device,"utilization_percent",
                primary.utilization_percent);
        if(ok && primary.has_vram)
            ok=yyjson_mut_obj_add_uint(d,device,"vram_total_bytes",
                primary.vram_total_bytes)
                && yyjson_mut_obj_add_uint(d,device,"vram_used_bytes",
                primary.vram_used_bytes);
        if(!ok || !yyjson_mut_arr_add_val(devices,device))return 0;
        *count=1;
        return yyjson_mut_obj_add_str(d,gpu,"scope",primary.source);
    }
    for(unsigned i=0;i<16;i++) {
        char path[160],name[24];
        unsigned long long busy=0,used=0,total=0,temp=0;
        snprintf(path,sizeof path,"/sys/class/drm/card%u/device/gpu_busy_percent",i);
        int has_busy=read_counter(path,&busy) && busy<=100;
        snprintf(path,sizeof path,"/sys/class/drm/card%u/device/mem_info_vram_used",i);
        int has_used=read_counter(path,&used);
        snprintf(path,sizeof path,"/sys/class/drm/card%u/device/mem_info_vram_total",i);
        int has_total=read_counter(path,&total);
        int has_temp=gpu_temperature(i,&temp) && temp<200000;
        if(!has_busy && !has_used && !has_total && !has_temp)continue;
        snprintf(name,sizeof name,"card%u",i);
        yyjson_mut_val *device=yyjson_mut_obj(d);
        int ok=device && yyjson_mut_obj_add_str(d,device,"id",name);
        if(ok && has_busy)ok=yyjson_mut_obj_add_uint(d,device,"utilization_percent",busy);
        if(ok && has_used)ok=yyjson_mut_obj_add_uint(d,device,"vram_used_bytes",used);
        if(ok && has_total)ok=yyjson_mut_obj_add_uint(d,device,"vram_total_bytes",total);
        if(ok && has_temp)ok=yyjson_mut_obj_add_real(d,device,"temperature_c",(double)temp/1000.0);
        if(!ok || !yyjson_mut_arr_add_val(devices,device))return 0;
        (*count)++;
    }
    if(!*count) {
        /* NVIDIA generally does not publish DRM counters. NVML is loaded
         * optionally at runtime, without shipping vendor headers or libs. */
        yag_gpu_snapshot sample={0};
        if(gpu_probe_primary(&sample)) {
            yyjson_mut_val *device=yyjson_mut_obj(d);
            int ok=device && yyjson_mut_obj_add_str(d,device,"id","gpu0");
            if(ok && sample.has_utilization)
                ok=yyjson_mut_obj_add_uint(d,device,"utilization_percent",
                    sample.utilization_percent);
            if(ok && sample.has_vram)
                ok=yyjson_mut_obj_add_uint(d,device,"vram_total_bytes",
                    sample.vram_total_bytes)
                && yyjson_mut_obj_add_uint(d,device,"vram_used_bytes",
                    sample.vram_used_bytes);
            if(!ok || !yyjson_mut_arr_add_val(devices,device))return 0;
            *count=1;
            return yyjson_mut_obj_add_str(d,gpu,"scope",sample.source);
        }
    }
    return yyjson_mut_obj_add_str(d,gpu,"scope","visible_linux_drm_sysfs");
}

void system_resources_handle(int fd) {
    unsigned long long usage=0,limit=0;
    int available=read_counter("/sys/fs/cgroup/memory.current",&usage);
    int limited=read_counter("/sys/fs/cgroup/memory.max",&limit);
    double one=0,five=0,fifteen=0,utilization=0;
    int load=read_load(&one,&five,&fifteen);
    int sampled=read_cpu_utilization(&utilization);
    unsigned long long host_total=0,host_available=0;
    int host_mem=read_visible_memory(&host_total,&host_available);
    long cores=sysconf(_SC_NPROCESSORS_ONLN);
    yyjson_mut_doc *d=yyjson_mut_doc_new(NULL);
    if(!d) {
        reply(fd,500,"application/json",
            "{\"error\":{\"message\":\"Out of memory\"}}");return;
    }
    yyjson_mut_val *root=yyjson_mut_obj(d);
    yyjson_mut_val *cpu=root?yyjson_mut_obj_add_obj(d,root,"cpu"):NULL;
    yyjson_mut_val *mem=root?yyjson_mut_obj_add_obj(d,root,"memory"):NULL;
    yyjson_mut_val *gpu=root?yyjson_mut_obj_add_obj(d,root,"gpu"):NULL;
    int ok=root && cpu && mem && gpu
        && yyjson_mut_obj_add_str(d,root,"object","gateway.resources")
        && yyjson_mut_obj_add_str(d,root,"scope","gateway_container")
        && yyjson_mut_obj_add_bool(d,cpu,"available",load || cores>0)
        && yyjson_mut_obj_add_bool(d,mem,"available",available)
        && yyjson_mut_obj_add_str(d,mem,"scope","cgroup_v2");
    if(ok && cores>0)ok=yyjson_mut_obj_add_sint(d,cpu,"logical_cores_visible",cores);
    if(ok && load)ok=yyjson_mut_obj_add_real(d,cpu,"load_1",one)
        && yyjson_mut_obj_add_real(d,cpu,"load_5",five)
        && yyjson_mut_obj_add_real(d,cpu,"load_15",fifteen);
    if(ok && sampled)ok=yyjson_mut_obj_add_real(d,cpu,"utilization_percent",utilization);
    if(ok && available)ok=yyjson_mut_obj_add_uint(d,mem,"used_bytes",usage);
    if(ok && limited)ok=yyjson_mut_obj_add_uint(d,mem,"limit_bytes",limit);
    if(ok && host_mem)ok=yyjson_mut_obj_add_uint(d,mem,"visible_host_total_bytes",host_total)
        && yyjson_mut_obj_add_uint(d,mem,"visible_host_available_bytes",host_available);
    if(ok)ok=yyjson_mut_obj_add_str(d,mem,"visible_host_scope","proc_meminfo");
    int gpu_count=0;
    if(ok)ok=add_gpu_sysfs(d,gpu,&gpu_count);
    if(ok)ok=yyjson_mut_obj_add_bool(d,gpu,"available",gpu_count>0);
    if(ok)yyjson_mut_doc_set_root(d,root);
    char *out=ok?yyjson_mut_write(d,0,NULL):NULL;
    if(out)reply(fd,200,"application/json",out);
    else reply(fd,500,"application/json",
        "{\"error\":{\"message\":\"System telemetry serialization failed\"}}");
    free(out);yyjson_mut_doc_free(d);
}
