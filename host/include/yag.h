#ifndef YAG_H
#define YAG_H
#include <stddef.h>
#include <time.h>
#include <pthread.h>
typedef struct {
    char *model;
    char *url;
    const char *key;
} yag_route;
typedef struct {
    const char *bind, *port, *upstream, *upstream_key, *api_key, *assets;
    char *extra_keys_storage;
    const char *extra_keys[16];
    size_t extra_key_count;
    yag_route routes[16];
    size_t route_count;
    long timeout;
    time_t started;
    pthread_mutex_t lock;
    unsigned active;
    unsigned long total;
    unsigned rate_limit_per_minute;
    time_t rate_windows[17];
    unsigned rate_counts[17];
} yag_config;
int config_load(yag_config *c);
const yag_config *config_for_model(const yag_config *c, const char *model, yag_config *selected);
int server_run(yag_config *c);
void upstream_request(int fd, const yag_config *c, const char *path, const char *body, size_t len, const char *model);
typedef size_t (*yag_upstream_write)(void *ctx, long status, const char *content_type, const char *data, size_t len);
int upstream_perform(const yag_config *c, const char *path, const char *body, size_t len, yag_upstream_write write_cb, void *ctx, long *status, int cancel_fd);
void responses_handle(int fd, const yag_config *c, const char *body, size_t len);
int send_all(int fd, const void *data, size_t len);
void reply(int fd, int status, const char *type, const char *body);
#endif
