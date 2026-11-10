#include "yag.h"
#include <curl/curl.h>
#include <signal.h>
int main(void) {
    yag_config config;
    signal(SIGPIPE, SIG_IGN);
    if (config_load(&config)) return 1;
    if (curl_global_init(CURL_GLOBAL_DEFAULT)) return 1;
    int rc=server_run(&config);
    /* server_run only returns on startup failure. */
    curl_global_cleanup();
    return rc ? 1 : 0;
}
