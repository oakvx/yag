#ifndef YAG_H
#define YAG_H
#include <stddef.h>
#include <time.h>
#include <pthread.h>
typedef struct {
    char *model;
    char *url;
    const char *key;
    int capabilities_declared;
    int tools, streaming, vision, reasoning;
    unsigned max_context_tokens;
    unsigned consecutive_connect_failures;
    time_t circuit_open_until;
} yag_route;
typedef struct {
    const char *bind, *port, *upstream, *upstream_key, *api_key, *assets;
    char *extra_keys_storage, *extra_scopes_storage;
    unsigned char extra_inference_only[16];
    const char *extra_keys[16];
    size_t extra_key_count;
    yag_route routes[16];
    size_t route_count;
    long timeout;
    time_t started;
    pthread_mutex_t lock;
    pthread_cond_t drained;
    unsigned active;
    unsigned long total;
    unsigned long chat_requests, responses_requests, anthropic_requests;
    unsigned long model_list_requests, provider_check_requests;
    unsigned rate_limit_per_minute;
    int fallback_to_default;
    int enforce_model_capabilities;
    unsigned circuit_failure_threshold, circuit_cooldown_seconds;
    unsigned long upstream_attempts, upstream_transport_failures, upstream_http_errors;
    unsigned long upstream_successes, upstream_total_latency_ms, circuit_rejections;
    time_t rate_windows[17];
    unsigned rate_counts[17];
} yag_config;
int config_load(yag_config *c);
void config_free(yag_config *c);
const yag_config *config_for_model(const yag_config *c, const char *model, yag_config *selected);
int server_run(yag_config *c);
void upstream_request(int fd, const yag_config *c, const char *path, const char *body, size_t len, const char *model);
typedef size_t (*yag_upstream_write)(void *ctx, long status, const char *content_type, const char *data, size_t len);
int upstream_perform(const yag_config *c, const char *path, const char *body, size_t len, yag_upstream_write write_cb, void *ctx, long *status, int cancel_fd);
int upstream_for_model(const yag_config *c,const char *model,const char *path,const char *body,size_t len,yag_upstream_write cb,void *ctx,long *status,int cancel_fd);
void responses_handle(int fd, const yag_config *c, const char *body, size_t len);
void anthropic_messages_handle(int fd, const yag_config *c, const char *body, size_t len);
void anthropic_stream_handle(int fd,const yag_config *target,const char *model,const char *chat_json);
void models_handle(int fd, const yag_config *c);
void provider_check_handle(int fd,const yag_config *cfg,const char *body,size_t len);
int send_all(int fd, const void *data, size_t len);
void reply(int fd, int status, const char *type, const char *body);
#endif
