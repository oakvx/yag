#include "yag.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static const char *env(const char *key, const char *fallback) { const char *v=getenv(key); return v && *v ? v : fallback; }
int config_load(yag_config *c) {
    memset(c, 0, sizeof(*c));
    c->bind=env("YAG_BIND", "127.0.0.1"); c->port=env("YAG_PORT", "8080");
    c->upstream=env("YAG_UPSTREAM_URL", "http://127.0.0.1:8000/v1");
    c->upstream_key=env("YAG_UPSTREAM_KEY", ""); c->api_key=env("YAG_API_KEY", "");
    c->assets=env("YAG_ASSETS", "console/dist"); c->timeout=120; c->started=time(NULL);
    const char *t=env("YAG_TIMEOUT", "120"); char *end=NULL; c->timeout=strtol(t,&end,10);
    if (*end || c->timeout < 1 || c->timeout > 3600) { fprintf(stderr,"YAG_TIMEOUT must be 1..3600 seconds\n"); return -1; }
    if (strlen(c->api_key)<16 || strpbrk(c->api_key,"\r\n") || strpbrk(c->upstream_key,"\r\n")) { fprintf(stderr,"YAG_API_KEY is required (at least 16 characters); keys must not contain newlines\n"); return -1; }
    if ((strncmp(c->upstream,"http://",7) && strncmp(c->upstream,"https://",8)) || strpbrk(c->upstream,"\r\n?#") || c->upstream[strlen(c->upstream)-1]=='/') { fprintf(stderr,"YAG_UPSTREAM_URL must be an HTTP(S) base URL without a trailing slash, query, or fragment\n"); return -1; }
    const char *extra=env("YAG_EXTRA_API_KEYS", "");
    if (*extra) {
        c->extra_keys_storage=strdup(extra);
        if (!c->extra_keys_storage) return -1;
        char *start=c->extra_keys_storage;
        for (;;) {
            char *comma=strchr(start, ',');
            if (comma) *comma=0;
            if (!*start || strlen(start)<16 || strpbrk(start,"\\r\\n") || c->extra_key_count>=16) {
                fprintf(stderr,"YAG_EXTRA_API_KEYS requires 1..16 comma-separated keys of at least 16 characters, without empty entries or newlines\\n");
                return -1;
            }
            c->extra_keys[c->extra_key_count++]=start;
            if (!comma) break;
            start=comma+1;
        }
    }
    if (strcmp(c->bind,"127.0.0.1") && strcmp(c->bind,"::1")) fprintf(stderr,"WARNING: LAN exposure enabled. HTTP is unencrypted; use a trusted TLS reverse proxy and firewall.\n");
    return pthread_mutex_init(&c->lock,NULL);
}
