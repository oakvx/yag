#ifndef YAG_H
#define YAG_H
#include <stddef.h>
#include <time.h>
#include <pthread.h>
typedef struct {
    unsigned long attempts,successes,failures,bypassed,fallthroughs;
    unsigned long latency_ms;
    unsigned long long prompt_tokens, completion_tokens;
    unsigned long usage_samples;
    unsigned consecutive_failures;
    time_t open_until;
    int half_open_probe;
    long last_http_status;
} yag_provider_stats;
typedef struct {
    char *model;
    unsigned feature_mask,context_window;
    int has_context_window;
} yag_model_capability;
typedef struct {
    char *model;
    char *url;
    const char *key;
    yag_provider_stats stats;
} yag_route;
typedef struct {
    char *url;
    const char *key;
    char *key_env;
    unsigned priority;
    int enabled;
    /* Operator-set admission controls, not measured GPU utilization. */
    unsigned max_inflight;
    unsigned vram_budget_mb, vram_reservation_mb, vram_reserved_mb;
    unsigned long admission_capacity_skips;
    /* Optional operator-declared per-replica model allowlist (not auto-discovery). */
    char *models[32];
    size_t model_count;
    yag_provider_stats stats;
    unsigned active, consecutive_failures;
    time_t unavailable_until;
} yag_pool_backend;
typedef struct {
    const char *bind, *port, *upstream, *upstream_key, *api_key, *assets;
    char *extra_keys_storage;
    char *extra_scope_storage;
    const char *extra_keys[16];
    unsigned extra_key_scopes[16];
    size_t extra_key_count;
    yag_route routes[16];
    size_t route_count;
    yag_pool_backend pool[8];
    size_t pool_count;
    unsigned default_pool_active, default_pool_failures, pool_cursor;
    unsigned primary_max_inflight, pool_wait_ms, pool_waiting;
    unsigned long pool_capacity_rejections;
    pthread_cond_t pool_available;
    time_t default_pool_unavailable_until;
    yag_model_capability capabilities[32];
    size_t capability_count;
    long timeout;
    time_t started;
    pthread_mutex_t lock;
    pthread_cond_t drained;
    unsigned active;
    unsigned long total;
    unsigned long chat_requests, completions_requests, embeddings_requests;
    unsigned long image_requests, speech_requests;
    unsigned long responses_requests, anthropic_requests;
    unsigned long model_list_requests, provider_check_requests;
    unsigned rate_limit_per_minute;
    int fallback_to_default;
    int enforce_model_capabilities;
    unsigned circuit_threshold, circuit_cooldown_seconds;
    unsigned header_deadline_seconds, body_deadline_seconds;
    unsigned max_body_bytes;
    yag_provider_stats default_provider_stats;
    time_t rate_windows[17];
    unsigned rate_counts[17];
    unsigned long key_accepted_requests[17];
    unsigned long key_rate_limited_requests[17];
    /* Bounded, fair per-credential inference admission control. */
    unsigned max_inference, max_per_key, queue_wait_ms;
    unsigned inference_active, inference_waiting;
    unsigned inference_inflight[17];
    struct yag_waiter *inference_head, *inference_tail;
    pthread_cond_t inference_available;

    /* Runtime-managed client keys; static ENV keys occupy first slots. */
    const char *client_store;
    const char *provider_store;
    /* Opt-in write-only audit trail for administrative HTTP responses. */
    int admin_audit_fd;
    size_t static_key_count;
    const char *ollama_admin_url;
    pthread_cond_t ollama_job_done;
    unsigned ollama_job_running, ollama_job_state, ollama_job_shutdown;
    unsigned long ollama_job_sequence;
    long ollama_job_http_status;
    char ollama_job_model[256];
    unsigned char key_enabled[16], key_managed[16];
    char *key_labels[16];
    char *managed_key_secrets[16];

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
void models_handle_detail(int fd, const yag_config *c, const char *model_id);
void provider_check_handle(int fd,const yag_config *cfg,const char *body,size_t len);
void providers_status_handle(int fd,yag_config *cfg);
void model_capabilities_handle(int fd,const yag_config *cfg);
int send_all(int fd, const void *data, size_t len);
void reply(int fd, int status, const char *type, const char *body);
int scheduler_acquire(yag_config *cfg, int key_index);
void scheduler_release(yag_config *cfg, int key_index);
void scheduler_status(int fd, yag_config *cfg);
void system_resources_handle(int fd);
void provider_pool_status_handle(int fd,yag_config *cfg);
int provider_manager_load(yag_config *cfg);
void provider_pool_free(yag_pool_backend pool[8],size_t count);
int provider_manager_handle(int fd,yag_config *cfg,const char *method,
                            const char *uri,const char *body,size_t len);
int ollama_admin_handle(int fd,yag_config *cfg,const char *method,
                        const char *uri,const char *body,size_t length);
void admin_audit_response(const yag_config *cfg,const char *resource,
                          const char *method,int status);
int client_registry_load(yag_config *cfg);
void client_registry_free(yag_config *cfg);
int client_registry_handle(int fd, yag_config *cfg, const char *method,
                           const char *uri, const char *body, size_t length);

#endif
