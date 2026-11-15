import { XmbScreen, XmbSectionLabel } from "@/components/XmbScreen";
import { XmbRow } from "@/components/XmbRow";
import { CodeBlock } from "@/components/CodeBlock";
import { BLOB_URL } from "@/data/repository";

type WireCaseId = "chat-pass" | "resp-tools" | "resp-reject" | "anth-tools" | "anth-reject";

interface FieldRule {
  field: string;
  action: "PASSTHROUGH" | "TRANSLATED" | "FLATTENED" | "NO-OP" | "REJECTED";
  detail: string;
}

interface WireCase {
  id: WireCaseId;
  protocol: "OpenAI Chat" | "OpenAI Responses" | "Anthropic Messages";
  title: string;
  qualification: "implemented" | "mock" | "absent";
  qualificationLabel: string;
  sourceFile: string;
  sourceHref: string;
  clientInput: string;
  upstreamOutput: string;
  outputLabel: string;
  sseSequence: string[];
  rules: FieldRule[];
}

const WIRE_CASES: WireCase[] = [
  {
    id: "chat-pass",
    protocol: "OpenAI Chat",
    title: "Chat Completions · Transparent Proxy",
    qualification: "implemented",
    qualificationLabel: "Transparent Passthrough",
    sourceFile: "host/src/http/server.c",
    sourceHref: `${BLOB_URL}/host/src/http/server.c`,
    clientInput: `POST /v1/chat/completions
Authorization: Bearer $YAG_API_KEY

{
  "model": "llama3.2",
  "messages": [
    {"role": "user", "content": "Inspect socket bounds"}
  ],
  "tools": [{"type": "function", "function": {"name": "stat"}}],
  "stream": true
}`,
    outputLabel: "Forwarded Upstream (/chat/completions)",
    upstreamOutput: `POST <YAG_UPSTREAM_URL>/chat/completions
Authorization: Bearer $YAG_UPSTREAM_KEY

{
  "model": "llama3.2",
  "messages": [
    {"role": "user", "content": "Inspect socket bounds"}
  ],
  "tools": [{"type": "function", "function": {"name": "stat"}}],
  "stream": true
}`,
    sseSequence: ["HTTP/1.1 200 OK (upstream status verbatim)", "data: {choices:[{delta:...}]}", "data: [DONE]"],
    rules: [
      {
        field: "model + messages[]",
        action: "PASSTHROUGH",
        detail: "server.c checks only that root is a JSON object with a model string and messages[] array.",
      },
      {
        field: "tools / custom fields",
        action: "PASSTHROUGH",
        detail: "All other fields, tool_calls, and response chunks pass unchanged; upstream decides semantics.",
      },
      {
        field: "Authorization header",
        action: "TRANSLATED",
        detail: "Client's gateway key is stripped; host's YAG_UPSTREAM_KEY (or route key_env) is attached.",
      },
    ],
  },
  {
    id: "resp-tools",
    protocol: "OpenAI Responses",
    title: "Responses · Namespace Tools & Stateless Map",
    qualification: "mock",
    qualificationLabel: "Mock-Qualified Subset",
    sourceFile: "host/src/protocols/openai_responses/request.c",
    sourceHref: `${BLOB_URL}/host/src/protocols/openai_responses/request.c`,
    clientInput: `POST /v1/responses
Authorization: Bearer $YAG_API_KEY

{
  "model": "response-echo",
  "instructions": "be concise",
  "input": "Read notes.txt",
  "max_output_tokens": 42,
  "store": false,
  "reasoning": {"effort": "low"},
  "tools": [{
    "type": "namespace",
    "name": "workspace",
    "tools": [{"type": "function", "name": "read_file", "parameters": {"type": "object"}}]
  }]
}`,
    outputLabel: "Translated Upstream (/chat/completions)",
    upstreamOutput: `{
  "model": "response-echo",
  "stream": false,
  "messages": [
    {"role": "system", "content": "be concise"},
    {"role": "user", "content": "Read notes.txt"}
  ],
  "tools": [{
    "type": "function",
    "function": {
      "name": "workspace__read_file",
      "parameters": {"type": "object"}
    }
  }],
  "max_tokens": 42,
  "reasoning_effort": "low"
}`,
    sseSequence: [
      "0: response.created",
      "1: response.in_progress",
      "2: response.output_item.added",
      "3: response.output_text.delta",
      "4: response.output_item.done",
      "5: response.completed",
    ],
    rules: [
      {
        field: "instructions",
        action: "TRANSLATED",
        detail: "Inserted as leading {role: 'system'} message in Chat messages[].",
      },
      {
        field: "tools[type=namespace]",
        action: "FLATTENED",
        detail: "Flattened to workspace__read_file upstream and restored to {namespace, name} on output.",
      },
      {
        field: "max_output_tokens",
        action: "TRANSLATED",
        detail: "Mapped to Chat max_tokens; reasoning.effort maps to reasoning_effort.",
      },
      {
        field: "store: false / metadata",
        action: "NO-OP",
        detail: "Omitted or false store accepted (stateless); metadata echoed on Response object, never sent upstream.",
      },
    ],
  },
  {
    id: "resp-reject",
    protocol: "OpenAI Responses",
    title: "Responses · Hosted Tool / Stateful Rejection",
    qualification: "absent",
    qualificationLabel: "Explicitly Rejected",
    sourceFile: "host/src/protocols/openai_responses/request.c",
    sourceHref: `${BLOB_URL}/host/src/protocols/openai_responses/request.c`,
    clientInput: `POST /v1/responses
Authorization: Bearer $YAG_API_KEY

{
  "model": "llama3.2",
  "input": "Search the web for news",
  "previous_response_id": "resp_99",
  "store": true,
  "tools": [{"type": "web_search"}]
}`,
    outputLabel: "Gateway HTTP 400 Rejection (Never Sent Upstream)",
    upstreamOutput: `HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": {
    "message": "Unsupported request field: previous_response_id"
  }
}
/* Also rejected with 400:
 * - store: true ("only store=false is supported")
 * - tools: [{"type": "web_search"}] ("Unsupported tool type: web_search") */`,
    sseSequence: ["No upstream call made — rejected synchronously during responses_parse()"],
    rules: [
      {
        field: "previous_response_id",
        action: "REJECTED",
        detail: "Stateful conversation chaining is not in the allowlist top[]; rejected with 400.",
      },
      {
        field: "store: true",
        action: "REJECTED",
        detail: "YAG stores no prompts or responses; store: true is explicitly refused.",
      },
      {
        field: "tools[type=web_search]",
        action: "REJECTED",
        detail: "Hosted server-side tools (web_search, file_search, computer_use) do not exist in YAG.",
      },
    ],
  },
  {
    id: "anth-tools",
    protocol: "Anthropic Messages",
    title: "Messages · Tool Replay & Thinking Coarsening",
    qualification: "mock",
    qualificationLabel: "Mock-Tested Subset",
    sourceFile: "host/src/protocols/anthropic/messages.c",
    sourceHref: `${BLOB_URL}/host/src/protocols/anthropic/messages.c`,
    clientInput: `POST /v1/messages
X-API-Key: $YAG_API_KEY
anthropic-version: 2023-06-01

{
  "model": "response-echo",
  "max_tokens": 512,
  "system": [{"type": "text", "text": "be brief", "cache_control": {"type": "ephemeral"}}],
  "thinking": {"type": "enabled", "budget_tokens": 128},
  "messages": [
    {"role": "user", "content": [
      {"type": "tool_result", "tool_use_id": "call_1", "content": "ENOENT", "is_error": true},
      {"type": "text", "text": "Retry with fallback path"}
    ]}
  ]
}`,
    outputLabel: "Translated Upstream (/chat/completions)",
    upstreamOutput: `{
  "model": "response-echo",
  "max_tokens": 512,
  "reasoning_effort": "high",
  "messages": [
    {"role": "system", "content": "be brief"},
    {
      "role": "tool",
      "tool_call_id": "call_1",
      "content": "[Tool execution error]\\nENOENT"
    },
    {
      "role": "user",
      "content": [{"type": "text", "text": "Retry with fallback path"}]
    }
  ]
}`,
    sseSequence: [
      "event: message_start",
      "event: content_block_start",
      "event: content_block_delta",
      "event: content_block_stop",
      "event: message_delta",
      "event: message_stop",
    ],
    rules: [
      {
        field: "X-API-Key header",
        action: "TRANSLATED",
        detail: "Accepted on /v1/messages carrying the YAG gateway secret; replaced by upstream Bearer secret.",
      },
      {
        field: "cache_control: ephemeral",
        action: "NO-OP",
        detail: "Validated for shape ({type:'ephemeral', ttl:'5m'|'1h'}), never applied as server-side prompt caching.",
      },
      {
        field: "thinking.budget_tokens",
        action: "TRANSLATED",
        detail: "Coarsened to reasoning_effort: 'high' (or 'medium' for adaptive); native thinking blocks are not preserved.",
      },
      {
        field: "tool_result (is_error: true)",
        action: "TRANSLATED",
        detail: "Ordered before trailing user text and prefixed with '[Tool execution error]\\n'.",
      },
    ],
  },
  {
    id: "anth-reject",
    protocol: "Anthropic Messages",
    title: "Messages · Prompt-Safe Rejection & 501 Bounds",
    qualification: "absent",
    qualificationLabel: "Bounded / Unimplemented",
    sourceFile: "host/src/protocols/anthropic/messages.c",
    sourceHref: `${BLOB_URL}/host/src/protocols/anthropic/messages.c`,
    clientInput: `POST /v1/messages
X-API-Key: $YAG_API_KEY

{
  "model": "response-echo",
  "max_tokens": 64,
  "messages": [
    {"role": "user", "content": [
      {"type": "image", "source": {"type": "base64", "data": "SECRET_IMAGE"}}
    ]}
  ]
}`,
    outputLabel: "Gateway Safe Rejection (Prompt Never Echoed)",
    upstreamOutput: `HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Unsupported Messages input: request contains fields or content not supported by this gateway"
  }
}
/* Note: POST /v1/messages/count_tokens returns 501 Not Implemented */`,
    sseSequence: ["Rejected prior to upstream call — verified by test_unsupported_shape_remains_a_safe_rejection"],
    rules: [
      {
        field: "content[type=image|document]",
        action: "REJECTED",
        detail: "Multimodal inputs are unsupported in the Messages adapter and fail closed with 400.",
      },
      {
        field: "Secret prompt payload",
        action: "NO-OP",
        detail: "Error body is a constant string; tests assert prompt content is never echoed back.",
      },
      {
        field: "/v1/messages/count_tokens",
        action: "REJECTED",
        detail: "Returns HTTP 501 'Anthropic token counting not implemented'.",
      },
    ],
  },
];

const ENDPOINTS = [
                      ["GET /health", "Public", "Liveness probe; no key required"],
                      ["GET /v1/models", "Discovery", "Merges default upstream /models + static route IDs"],
                      ["GET /v1/models/{id}", "Discovery", "Exact ID from merged inventory; 404 if unknown"],
                      ["POST /v1/chat/completions", "Passthrough", "SSE + tool_calls; checks model & messages[]"],
                      ["POST /v1/completions", "Passthrough", "Legacy completions; checks model & prompt"],
                      ["POST /v1/embeddings", "Passthrough", "Vector embeddings; requires upstream embedding model"],
                      ["POST /v1/images/generations", "Passthrough", "Checks model & prompt; upstream dependent"],
                      ["POST /v1/audio/speech", "Passthrough", "Checks model, input & voice; upstream dependent"],
                      ["POST /v1/responses", "Translated", "Stateless subset → Chat; 4 MiB / 64-item bound"],
                      ["POST /v1/messages", "Translated", "Bounded subset → Chat; Bearer or X-API-Key"],
                      ["POST /v1/messages/count_tokens", "501 Refused", "Explicitly returns 501 Not Implemented"],
];

export function ProtocolsPage() {
  return <XmbScreen document={<p>Chat Completions passes through unchanged. Responses and Anthropic Messages use bounded, stateless adapters into Chat. These examples show the actual wire transformations, field rules and explicit rejections; mock qualification does not certify real-model compatibility.</p>} subtitle="One transparent proxy and two bounded translators. Mock qualification is not real-model certification." sections={[
    ...WIRE_CASES.map((wire) => ({ id: wire.id, interactive: true, label: wire.title.split(" · ")[0] + (wire.id.includes("reject") ? " · rejection" : ""), entries: [
      { key: `${wire.id}-payload`, title: wire.title, value: wire.qualificationLabel, description: `${wire.protocol}: inspect the client input, adapter result and return events.`, panel: <>
        <XmbSectionLabel>Client wire input · {wire.protocol}</XmbSectionLabel><CodeBlock code={wire.clientInput} lang="json" showLineNumbers={false} />
        <XmbSectionLabel>{wire.outputLabel}</XmbSectionLabel><CodeBlock code={wire.upstreamOutput} lang="json" showLineNumbers={false} />
        <XmbSectionLabel>Return event order</XmbSectionLabel><ol>{wire.sseSequence.map((event) => <li key={event}>{event}</li>)}</ol>
        <XmbRow href={wire.sourceHref} value={wire.sourceFile}>Adapter source</XmbRow>
      </> },
      ...wire.rules.map((rule) => ({ key: `${wire.id}-${rule.field}`, title: rule.field, value: rule.action, description: rule.detail, panel: <>
        <XmbSectionLabel>{rule.action}</XmbSectionLabel><p>{rule.detail}</p><CodeBlock code={wire.clientInput} lang="json" showLineNumbers={false} /><XmbSectionLabel>{wire.outputLabel}</XmbSectionLabel><CodeBlock code={wire.upstreamOutput} lang="json" showLineNumbers={false} />
      </> })),
    ] })),
    { id: "endpoints", label: "Endpoints", entries: ENDPOINTS.map(([title, value, description]) => ({ key: title, title, value, description })) },
    { id: "scope", label: "Qualification", entries: [
      { key: "mock", title: "CLI compatibility", value: "Mock tested", panel: <><p>Pinned Codex CLI 0.167.0 (text and local exec_command) and Claude Code CLI (streaming text and local Read) passed isolated tests against a deterministic mock backend. Real inference models and full CLI toolchains remain unverified.</p><XmbRow to="/status">Full qualification matrix</XmbRow></> },
      { key: "unsupported", title: "Unsupported adapter features", value: "Explicit rejection", panel: <ul><li>Hosted server tools and server-side execution.</li><li>Multimodal image, audio or document inputs in Responses and Messages.</li><li>Stateful Responses: store=true and previous_response_id.</li><li>Native Anthropic thinking, prompt caching and token counting.</li></ul> },
    ] },
  ]} />;
}
