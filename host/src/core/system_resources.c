#include "yag.h"
#include "yyjson.h"
#include <errno.h>
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
void system_resources_handle(int fd) {
    unsigned long long usage=0,limit=0;
    int available=read_counter("/sys/fs/cgroup/memory.current",&usage);
    int limited=read_counter("/sys/fs/cgroup/memory.max",&limit);
    double one=0,five=0,fifteen=0;
    int load=read_load(&one,&five,&fifteen);
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
        && yyjson_mut_obj_add_str(d,mem,"scope","cgroup_v2")
        && yyjson_mut_obj_add_bool(d,gpu,"available",false);
    if(ok && cores>0)ok=yyjson_mut_obj_add_sint(d,cpu,"logical_cores_visible",cores);
    if(ok && load)ok=yyjson_mut_obj_add_real(d,cpu,"load_1",one)
        && yyjson_mut_obj_add_real(d,cpu,"load_5",five)
        && yyjson_mut_obj_add_real(d,cpu,"load_15",fifteen);
    if(ok && available)ok=yyjson_mut_obj_add_uint(d,mem,"used_bytes",usage);
    if(ok && limited)ok=yyjson_mut_obj_add_uint(d,mem,"limit_bytes",limit);
    if(ok)yyjson_mut_doc_set_root(d,root);
    char *out=ok?yyjson_mut_write(d,0,NULL):NULL;
    if(out)reply(fd,200,"application/json",out);
    else reply(fd,500,"application/json",
        "{\"error\":{\"message\":\"System telemetry serialization failed\"}}");
    free(out);yyjson_mut_doc_free(d);
}
