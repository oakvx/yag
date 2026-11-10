#ifndef YAG_RESPONSES_H
#define YAG_RESPONSES_H
#include "yag.h"
#include "yyjson.h"
typedef struct {
    yyjson_doc *input_doc; /* Owns request values until response serialization finishes. */
    yyjson_val *root;
    char *chat_json;
    int stream;
    char diagnostic[256];
} response_request;
/* Returns 0 on success; err points to a static diagnostic on failure. */
int responses_parse(const char *body, size_t len, response_request *out, const char **err);
void responses_request_free(response_request *r);
#endif
