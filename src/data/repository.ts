export const REPO_URL = "https://github.com/oakvx/yag";
export const BLOB_URL = `${REPO_URL}/blob/main`;
export const TREE_URL = `${REPO_URL}/tree/main`;

export const REPO_LINKS = {
  repo: REPO_URL,
  author: "https://github.com/oakvx",
  readme: `${REPO_URL}#readme`,
  endpoints: `${REPO_URL}#endpoints`,
  build: `${REPO_URL}#build`,
  run: `${REPO_URL}#run`,
  config: `${REPO_URL}#configuration`,
  security: `${REPO_URL}#security-threat-model`,
  statusDoc: `${BLOB_URL}/docs/architecture/STATUS.md`,
  dockerDoc: `${BLOB_URL}/docs/deployment/docker.md`,
  lanHubDoc: `${BLOB_URL}/docs/deployment/lan-hub.md`,
  releasesDoc: `${BLOB_URL}/docs/deployment/releases.md`,
  integrationsDoc: `${BLOB_URL}/docs/integrations/README.md`,
  codexDoc: `${BLOB_URL}/docs/integrations/codex.md`,
  claudeCodeDoc: `${BLOB_URL}/docs/integrations/claude-code.md`,
  ollamaDoc: `${BLOB_URL}/docs/integrations/ollama-colibri.md`,
  liveModelDoc: `${BLOB_URL}/docs/integrations/live-model.md`,
  realModelDoc: `${BLOB_URL}/docs/integrations/real-model.md`,
  license: `${BLOB_URL}/LICENSE`,
  issues: `${REPO_URL}/issues`,
  newIssue: `${REPO_URL}/issues/new`,
};

export type SourceCategory = "Entry & Structs" | "Listener & Auth" | "Routing & Transport" | "Protocol Adapters" | "Build & Tests";

export interface SourceExcerpt {
  id: string;
  shortTitle: string;
  path: string;
  href: string;
  lang: "c" | "python" | "cmake" | "bash" | "json";
  category: SourceCategory;
  kindLabel: "Host C17 Source" | "Header Definition" | "Build Definition" | "Mock Contract Test";
  summary: string;
  highlights: number[];
  code: string;
  notes: string[];
  caveat: string;
  relatedRoute: string;
  relatedLabel: string;
}

export const SOURCE_EXCERPTS: SourceExcerpt[] = [
  {
    id: "main-c",
    shortTitle: "Host Entrypoint",
    path: "host/src/main.c",
    href: `${BLOB_URL}/host/src/main.c`,
    lang: "c",
    category: "Entry & Structs",
    kindLabel: "Host C17 Source",
    summary:
      "The entire executable entrypoint is fourteen lines of C17: ignore SIGPIPE so a disconnected client cannot kill the process, load immutable environment configuration, initialize libcurl, run the listener, and clean up cleanly.",
    highlights: [4, 5, 6, 7],
    code: `#include "yag.h"

int main(void) {
  yag_config config;
  signal(SIGPIPE, SIG_IGN);
  if (config_load(&config)) return 1;
  if (curl_global_init(CURL_GLOBAL_DEFAULT)) return 1;
  int rc = server_run(&config);
  curl_global_cleanup();
  config_free(&config);
  return rc ? 1 : 0;
}`,
    notes: [
      "Configuration is loaded once at startup into stack-allocated yag_config; invalid env settings fail closed before any socket binds.",
      "SIGPIPE is ignored globally (paired with MSG_NOSIGNAL in send_all) so broken client streams never terminate the gateway.",
      "server_run() drains active worker threads on SIGINT/SIGTERM before curl_global_cleanup() runs.",
    ],
    caveat: "Header includes abbreviated here for layout; the logic and order in host/src/main.c are verbatim.",
    relatedRoute: "/architecture",
    relatedLabel: "Inspect in System Architecture",
  },
  {
    id: "yag-h",
    shortTitle: "Bounded State Structs",
    path: "host/include/yag.h",
    href: `${BLOB_URL}/host/include/yag.h`,
    lang: "c",
    category: "Entry & Structs",
    kindLabel: "Header Definition",
    summary:
      "Fixed-capacity arrays define YAG's operational ceiling directly in memory: up to 16 extra API keys, 16 exact-model routes, 8 pool replicas, and 32 operator-declared capability hints, plus in-memory provider counters.",
    highlights: [4, 5, 11, 12, 13, 18, 19],
    code: `typedef struct {
  char *model;
  char *url;
  const char *key;
  yag_provider_stats stats;
} yag_route;

typedef struct {
  const char *bind, *port, *upstream, *upstream_key, *api_key, *assets;
  const char *extra_keys[16];
  unsigned extra_key_scopes[16];
  size_t extra_key_count;
  yag_route routes[16];
  size_t route_count;
  yag_pool_backend pool[8];
  size_t pool_count;
  yag_model_capability capabilities[32];
  long timeout;
  pthread_mutex_t lock;
  pthread_cond_t drained;
  unsigned active;
  unsigned rate_limit_per_minute;
  int fallback_to_default;
  unsigned circuit_threshold, circuit_cooldown_seconds;
  unsigned header_deadline_seconds, body_deadline_seconds;
  unsigned max_body_bytes;
} yag_config;`,
    notes: [
      "Every route owns its own yag_provider_stats struct (attempts, failures, latency_ms, consecutive_failures, open_until).",
      "No prompt history or request RingBuffer exists in yag_config — only unsigned long aggregate counters guarded by lock.",
      "Static ceilings (16 keys, 16 routes, 32 capabilities) eliminate unbounded dynamic table growth.",
    ],
    caveat: "Selected fields from yag_config in host/include/yag.h; scheduler and client-registry fields omitted for brevity.",
    relatedRoute: "/security",
    relatedLabel: "View Trust Boundaries",
  },
  {
    id: "server-auth",
    shortTitle: "Pre-Body Header Auth",
    path: "host/src/http/server.c",
    href: `${BLOB_URL}/host/src/http/server.c`,
    lang: "c",
    category: "Listener & Auth",
    kindLabel: "Host C17 Source",
    summary:
      "YAG authenticates headers BEFORE allocating or reading request bodies and BEFORE sending 100 Continue. An unauthenticated or under-scoped client cannot hold a worker open on a slow POST body.",
    highlights: [2, 6, 8, 9, 17, 23, 27],
    code: `/* Authenticate from headers BEFORE buffering potentially large request bodies.
 * Never let an unauthenticated client monopolize an active worker on a slow POST. */
int api = !strncmp(uri, "/v1/", 4) || !strncmp(uri, "/api/", 5);
if (api) {
  int is_messages = !strcmp(uri, "/v1/messages") || !strcmp(uri, "/v1/messages/count_tokens");
  if (auth && native_key) { error(fd, 400, "Choose one authentication header"); goto done; }
  pthread_mutex_lock(&c->lock);
  key_index = auth ? authenticated_key(c, auth)
                   : (is_messages && native_key ? authenticated_raw_key(c, native_key) : -1);
  pthread_mutex_unlock(&c->lock);
  if (key_index < 0) { error(fd, 401, "Unauthorized"); goto done; }

  pthread_mutex_lock(&c->lock);
  unsigned scope = key_index == 0 ? 15u : c->extra_key_scopes[key_index - 1];
  pthread_mutex_unlock(&c->lock);
  if (!(scope & required)) { error(fd, 403, "Insufficient API key scope"); goto done; }

  unsigned retry_after = 0;
  if (!rate_permit(c, key_index, &retry_after)) {
    rate_limited(fd, retry_after); goto done;
  }
}
/* Send 100 Continue only AFTER authenticating and checking request size. */`,
    notes: [
      "Competing Authorization and X-API-Key headers on the same request are rejected with HTTP 400 to prevent ambiguous auth framing.",
      "X-API-Key is accepted only on /v1/messages routes; /v1/models and OpenAI routes require Authorization: Bearer.",
      "Rate-limit checks happen immediately after scope verification and return 429 with Retry-After seconds remaining.",
    ],
    caveat: "Excerpted from handle() in host/src/http/server.c.",
    relatedRoute: "/lifecycle",
    relatedLabel: "Trace Stage 02 · Auth",
  },
  {
    id: "server-routes-redact",
    shortTitle: "Redacted Route Inspection",
    path: "host/src/http/server.c",
    href: `${BLOB_URL}/host/src/http/server.c`,
    lang: "c",
    category: "Listener & Auth",
    kindLabel: "Host C17 Source",
    summary:
      "When an authenticated client queries GET /api/routes, the host serializes only the configured model identifiers — upstream URLs and secret environment references never cross the socket.",
    highlights: [5, 6, 7, 8],
    code: `else if (!strcmp(uri, "/api/routes") && !strcmp(method, "GET")) {
  yyjson_mut_doc *d = yyjson_mut_doc_new(NULL);
  if (!d) { error(fd, 500, "Out of memory"); goto done; }
  yyjson_mut_val *root = yyjson_mut_obj(d), *routes = yyjson_mut_obj_add_arr(d, root, "data");
  yyjson_mut_obj_add_str(d, root, "object", "list");
  for (size_t i = 0; i < c->route_count; i++) {
    yyjson_mut_val *route = yyjson_mut_obj(d);
    yyjson_mut_obj_add_strcpy(d, route, "model", c->routes[i].model);
    yyjson_mut_arr_add_val(routes, route);
  }
  yyjson_mut_doc_set_root(d, root);
  char *serialized = yyjson_mut_write(d, 0, NULL);
  if (serialized) reply(fd, 200, "application/json", serialized);
  free(serialized); yyjson_mut_doc_free(d);
}`,
    notes: [
      "Notice that c->routes[i].url and c->routes[i].key are intentionally omitted from the serialized JSON object.",
      "Clients only need to know which model IDs exist; backend topology stays opaque behind the gateway.",
    ],
    caveat: "Excerpted from handle() in host/src/http/server.c.",
    relatedRoute: "/routing",
    relatedLabel: "Test in Model Routing",
  },
  {
    id: "config-routes",
    shortTitle: "Exact-Model Route Lookup",
    path: "host/src/core/config.c",
    href: `${BLOB_URL}/host/src/core/config.c`,
    lang: "c",
    category: "Routing & Transport",
    kindLabel: "Host C17 Source",
    summary:
      "Route selection is an exact strcmp() scan over c->routes. A match populates a temporary config struct with that route's URL and host-resolved secret; no match returns the default upstream config.",
    highlights: [3, 4, 6, 7, 11],
    code: `const yag_config *config_for_model(const yag_config *c, const char *model, yag_config *selected)
{
  if (model)
    for (size_t i = 0; i < c->route_count; i++) {
      if (strcmp(model, c->routes[i].model)) continue;
      memset(selected, 0, sizeof *selected);
      selected->upstream = c->routes[i].url;
      selected->upstream_key = c->routes[i].key;
      selected->timeout = c->timeout;
      return selected;
    }
  return c;
}`,
    notes: [
      "Zero regexes, prefix wildcards, or provider heuristics: strcmp(model, c->routes[i].model) == 0 is the entire rule.",
      "Route secrets (c->routes[i].key) were already resolved via getenv(key_env) during load_routes() at startup.",
      "Timeout is inherited uniformly from the host configuration.",
    ],
    caveat: "Verbatim function from host/src/core/config.c.",
    relatedRoute: "/routing",
    relatedLabel: "Open Interactive Router",
  },
  {
    id: "openai-upstream",
    shortTitle: "Upstream Poll & Fallback",
    path: "host/src/inference/openai.c",
    href: `${BLOB_URL}/host/src/inference/openai.c`,
    lang: "c",
    category: "Routing & Transport",
    kindLabel: "Host C17 Source",
    summary:
      "Upstream transfers run inside a 100 ms curl_multi_poll loop so client disconnects cancel silent inference streams promptly. Opt-in fallback retries ONLY pre-response DNS or TCP connect failures — never HTTP errors or timeouts.",
    highlights: [4, 5, 6, 15, 16, 17, 21],
    code: `/* Multi polling gives us a bounded opportunity to check the client socket every 100 ms. */
do {
  mc = curl_multi_perform(multi, &running);
  if (mc != CURLM_OK || !running) break;
  mc = curl_multi_poll(multi, NULL, 0, 100, &activity);
  if (cancel_fd >= 0 && peer_closed(cancel_fd)) {
    result = (int)CURLE_ABORTED_BY_CALLBACK; break;
  }
} while (running);

/* Retry only when connection setup definitively failed before receiving an
 * HTTP response. Timeouts are ambiguous; never retry those. */
int rc = measured_upstream(state, target, stats, path, body, len, cb, ctx, status, cancel_fd);
if (c->fallback_to_default && target != c && (!status || !*status) &&
    (rc == CURLE_COULDNT_CONNECT || rc == CURLE_COULDNT_RESOLVE_HOST)) {
  pthread_mutex_lock(&state->lock);
  stats->fallthroughs++;
  pthread_mutex_unlock(&state->lock);
  if (status) *status = 0;
  return measured_upstream(state, c, &state->default_provider_stats,
                           path, body, len, cb, ctx, status, cancel_fd);
}`,
    notes: [
      "peer_closed(cancel_fd) polls the client socket even when an upstream LLM is silent while computing prompt prefill.",
      "Once any HTTP status is received (*status != 0) or a timeout occurs, YAG never replays the request to another backend.",
      "Upstream Authorization: Bearer <upstream_key> is attached inside upstream_perform() and freed immediately after.",
    ],
    caveat: "Two adjacent excerpts from upstream_perform() and upstream_for_model() in host/src/inference/openai.c.",
    relatedRoute: "/lifecycle",
    relatedLabel: "Trace Stage 05 · Forward",
  },
  {
    id: "responses-adapter",
    shortTitle: "Responses Stateless Adapter",
    path: "host/src/protocols/openai_responses/request.c",
    href: `${BLOB_URL}/host/src/protocols/openai_responses/request.c`,
    lang: "c",
    category: "Protocol Adapters",
    kindLabel: "Host C17 Source",
    summary:
      "POST /v1/responses enforces a strict allowlist of top-level fields, requires stateless operation (store=false or omitted), flattens namespace tools into workspace__tool, and rejects hosted server tools explicitly.",
    highlights: [3, 4, 10, 11, 17, 19],
    code: `const char *const top[] = {
  "model", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls",
  "max_output_tokens", "temperature", "top_p", "stream", "text", "reasoning",
  "metadata", "store", "prompt_cache_key", "include", "client_metadata", NULL
};

if (!isstr(model) || !*yyjson_get_str(model) || !input ||
    (inst && !isstr(inst) && !yyjson_is_null(inst)) ||
    (stream && !yyjson_is_bool(stream)) ||
    (store && (!yyjson_is_bool(store) || yyjson_get_bool(store)))) {
  *err = "Invalid model, input, instructions, stream, metadata or store (only store=false is supported)";
  return 0;
}

if (inst && !yyjson_is_null(inst) && !add_message(d, messages, "system", inst)) goto done;
if (!translate_input(d, messages, input) || !yyjson_mut_obj_add_val(d, chat, "messages", messages)) {
  *err = "Unsupported input item or content; only text messages and function calls/results are supported";
  goto done;
}`,
    notes: [
      "instructions becomes a leading system message in the translated Chat Completions messages[] array.",
      "store: true or previous_response_id are rejected because YAG stores zero conversation state.",
      "Hosted tools such as web_search fail translate_tools() with 'Unsupported tool type: web_search'.",
    ],
    caveat: "Excerpted from responses_parse() in host/src/protocols/openai_responses/request.c.",
    relatedRoute: "/protocols",
    relatedLabel: "Inspect Protocol Wire Map",
  },
  {
    id: "anthropic-adapter",
    shortTitle: "Anthropic Messages Adapter",
    path: "host/src/protocols/anthropic/messages.c",
    href: `${BLOB_URL}/host/src/protocols/anthropic/messages.c`,
    lang: "c",
    category: "Protocol Adapters",
    kindLabel: "Host C17 Source",
    summary:
      "POST /v1/messages translates system text blocks, tool_use / tool_result items, and coarse thinking hints into Chat Completions, while rejecting unsupported shapes with a fixed error message that never echoes prompts.",
    highlights: [2, 3, 9, 12, 14, 21],
    code: `static void anthropic_error(int fd, int status) {
  if (status == 400)
    reply(fd, 400, "application/json",
      "{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\","
      "\"message\":\"Unsupported Messages input: request contains fields or content not supported by this gateway\"}}");
}

/* Map thinking intent to Chat's coarser reasoning_effort knob. The exact
 * Anthropic budget and native thinking blocks cannot be preserved. */
static int thinking_valid(yyjson_val *thinking, const char **effort) {
  *effort = NULL;
  if (!thinking) return 1;
  if (yyjson_equals_str(type, "disabled")) return budget == NULL;
  if (yyjson_equals_str(type, "adaptive")) { if (budget) return 0; *effort = "medium"; return 1; }
  if (yyjson_equals_str(type, "enabled") && yyjson_is_int(budget) && yyjson_get_sint(budget) > 0) {
    *effort = "high"; return 1;
  }
  return 0;
}

if (requested_stream && yyjson_get_bool(requested_stream)) {
  anthropic_stream_handle(fd, cfg, model, json);
}`,
    notes: [
      "Both non-streaming and SSE streaming (anthropic_stream_handle) are implemented for text and function tools within the bounded subset.",
      "is_error: true on a tool_result prepends '[Tool execution error]\\n' to the translated Chat tool message.",
      "POST /v1/messages/count_tokens is explicitly rejected with 501 Not Implemented in server.c.",
    ],
    caveat: "Selected functions from host/src/protocols/anthropic/messages.c.",
    relatedRoute: "/protocols",
    relatedLabel: "Compare in Protocol Landscape",
  },
  {
    id: "cmake-build",
    shortTitle: "CMake Native Target",
    path: "CMakeLists.txt",
    href: `${BLOB_URL}/CMakeLists.txt`,
    lang: "cmake",
    category: "Build & Tests",
    kindLabel: "Build Definition",
    summary:
      "One C17 executable compiled with -Wall -Wextra -Wpedantic against libcurl, POSIX threads, and vendored yyjson, wired directly to 15 Python contract test suites via CTest.",
    highlights: [2, 5, 6, 7, 17, 18],
    code: `cmake_minimum_required(VERSION 3.16)
project(yag VERSION 0.1.0 LANGUAGES C)
set(CMAKE_C_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED ON)
find_package(CURL REQUIRED)
find_package(Threads REQUIRED)
add_executable(yag
  host/src/main.c
  host/src/http/server.c
  host/src/inference/openai.c
  host/src/inference/models.c
  host/src/core/config.c
  host/src/protocols/openai_responses/request.c
  host/src/protocols/openai_responses/response.c
  host/src/protocols/anthropic/messages.c
  host/src/protocols/anthropic/stream.c
  third_party/yyjson/yyjson.c)
target_link_libraries(yag PRIVATE CURL::libcurl Threads::Threads)
target_compile_options(yag PRIVATE -Wall -Wextra -Wpedantic)`,
    notes: [
      "Zero external package registries are needed to compile the native host binary.",
      "yyjson 0.12.0 is vendored directly in third_party/yyjson/ with its MIT license.",
      "CTest runs integration, responses, anthropic, rate_limit, fallback, circuit_breaker, shutdown, and http_fuzz suites.",
    ],
    caveat: "Auxiliary source files (health.c, scheduler.c, etc.) condensed for display; see full CMakeLists.txt on GitHub.",
    relatedRoute: "/deploy",
    relatedLabel: "Open Build & Deploy Runbook",
  },
  {
    id: "tests-contract",
    shortTitle: "Mock Contract Verification",
    path: "tests/anthropic.py",
    href: `${BLOB_URL}/tests/anthropic.py`,
    lang: "python",
    category: "Build & Tests",
    kindLabel: "Mock Contract Test",
    summary:
      "Automated tests verify wire framing, SSE event ordering, and prompt-safe rejection against a deterministic local mock backend — never claiming live inference model certification.",
    highlights: [2, 3, 4, 10, 14, 15],
    code: `def test_streaming_text_event_order(self):
    events = self.sse('response-stream')
    types = [e['type'] for e in events]
    self.assertEqual(types, ['message_start', 'content_block_start',
        'content_block_delta', 'content_block_delta', 'content_block_stop',
        'message_delta', 'message_stop'])
    self.assertEqual(''.join(e['delta']['text'] for e in events
        if e['type'] == 'content_block_delta'), 'Hello world')

def test_unsupported_shape_remains_a_safe_rejection(self):
    payload = {'model': 'response-echo', 'max_tokens': 16,
               'messages': [{'role': 'user', 'content': 'SECRET_PROMPT'}],
               'thinking': {'type': 'invalid', 'budget_tokens': 1024}}
    status, _, body = self.post(payload)
    self.assertEqual(status, 400, body)
    self.assertNotIn(b'SECRET_PROMPT', body)`,
    notes: [
      "Asserts exact SSE frame ordering and verifies that rejected payloads never reflect SECRET_PROMPT in error responses.",
      "Uses the deterministic mock Chat server from tests/integration.py, not a live LLM.",
    ],
    caveat: "Verbatim methods from tests/anthropic.py. Passing mock tests does not verify real-model compatibility.",
    relatedRoute: "/status",
    relatedLabel: "Inspect Qualification Matrix",
  },
];

export function getExcerptById(id: string): SourceExcerpt {
  return SOURCE_EXCERPTS.find((e) => e.id === id) ?? SOURCE_EXCERPTS[0];
}
