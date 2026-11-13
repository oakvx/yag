#include "yag.h"
#include <errno.h>
#include <stdio.h>
#include <time.h>
#include <unistd.h>

/* No request bodies, API keys, model names, client labels, IP addresses or
 * arbitrary URL segments may enter the audit trail. Callers pass ONLY static
 * route/method labels. An entry means the server attempted the final HTTP
 * response; it does not guarantee the remote peer received the bytes. */
void admin_audit_response(const yag_config *cfg,const char *resource,
                          const char *method,int status) {
    if(!cfg || cfg->admin_audit_fd<0)return;
    char line[224];
    int n=snprintf(line,sizeof line,
        "{\"ts_unix\":%lld,\"event\":\"admin_http_response\","
        "\"resource\":\"%s\",\"method\":\"%s\",\"status\":%d}\n",
        (long long)time(NULL),resource,method,status);
    if(n<=0 || (size_t)n>=sizeof line)return;
    ssize_t written;
    do {
        written=write(cfg->admin_audit_fd,line,(size_t)n);
    } while(written<0 && errno==EINTR);
    if(written!=(ssize_t)n)
        fputs("WARNING: failed to append an administrator audit event\n",stderr);
}
