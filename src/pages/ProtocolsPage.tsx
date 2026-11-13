import { useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import { BLOB_URL } from "@/data/repository";
import { RouteLink } from "@/router/RouterContext";
import { cn } from "@/utils/cn";

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

const ACTION_COLOR: Record<FieldRule["action"], string> = {
  PASSTHROUGH: "border-moss/50 text-moss bg-moss/10",
  TRANSLATED: "border-amber/50 text-amber bg-amber/10",
  FLATTENED: "border-amber/50 text-paper bg-amber/15",
  "NO-OP": "border-line-strong text-muted bg-panel",
  REJECTED: "border-rust/50 text-rust bg-rust/10",
};

export function ProtocolsPage() {
  const [caseId, setCaseId] = useState<WireCaseId>("resp-tools");
  const [selectedRuleIdx, setSelectedRuleIdx] = useState(0);

  const activeCase = WIRE_CASES.find((w) => w.id === caseId) ?? WIRE_CASES[0];

  return (
    <div>
      <PageMasthead
        path="/protocols"
        eyebrow="Chapter 04 · Protocol Analyzer & Wire Interchange"
        title={
          <>
            One transparent proxy. <em>Two strictly bounded translators.</em>
          </>
        }
        lede="YAG does not claim universal protocol equivalence. Chat Completions is forwarded verbatim; OpenAI Responses and Anthropic Messages are narrow, stateless-to-Chat adapters that reject unsupported shapes explicitly rather than dropping fields silently."
        meta={[
          { k: "Chat /v1", v: "Transparent passthrough", tone: "moss" },
          { k: "Responses", v: "Stateless subset → Chat (mock-tested)", tone: "amber" },
          { k: "Messages", v: "Bounded subset → Chat (mock-tested)", tone: "amber" },
        ]}
      />

      {/* SIGNATURE INTERACTIVE C: PROTOCOL TRANSFORMATION WORKBENCH */}
      <section className="border-b border-line py-6 @lg:py-8">
        <Container>
          <div className="border border-line-strong bg-panel">
            {/* Case Selector Tabs */}
            <div className="border-b border-line px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
                <span className="label text-amber">Interactive Wire Transformation Inspector</span>
                <StatusBadge tone={activeCase.qualification}>{activeCase.qualificationLabel}</StatusBadge>
              </div>
              <div role="tablist" aria-label="Protocol wire transformation cases" className="flex flex-wrap gap-1.5">
                {WIRE_CASES.map((wc) => {
                  const selected = wc.id === caseId;
                  return (
                    <button
                      key={wc.id}
                      role="tab"
                      aria-selected={selected}
                      onClick={() => {
                        setCaseId(wc.id);
                        setSelectedRuleIdx(0);
                      }}
                      className={cn(
                        "border px-3 py-1.5 font-mono text-[10.5px] transition-colors cursor-pointer",
                        selected
                          ? "border-amber bg-amber/15 text-paper"
                          : "border-line text-faint hover:text-paper",
                      )}
                    >
                      {wc.title}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3-Column Wire Transformation Stage */}
            <div className="grid @3xl:grid-cols-12">
              {/* Column 1: Client Wire Payload */}
              <div className="border-b border-line p-4 @lg:p-5 @3xl:col-span-5 @3xl:border-b-0 @3xl:border-r">
                <div className="mb-2.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em]">
                  <span className="text-paper">01 · Client Wire Input</span>
                  <span className="text-faint">{activeCase.protocol}</span>
                </div>
                <CodeBlock code={activeCase.clientInput} lang="json" showLineNumbers={false} />
              </div>

              {/* Column 2: Adapter Mapping Rules */}
              <div className="border-b border-line bg-[rgba(3,12,34,0.5)] p-4 @lg:p-5 @3xl:col-span-3 @3xl:border-b-0 @3xl:border-r">
                <div className="mb-2.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em]">
                  <span className="text-amber">02 · Adapter Rules</span>
                  <a
                    href={activeCase.sourceHref}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-faint hover:text-amber"
                  >
                    source ↗
                  </a>
                </div>

                <ul className="space-y-2">
                  {activeCase.rules.map((rule, idx) => {
                    const isFocused = idx === selectedRuleIdx;
                    return (
                      <li key={rule.field}>
                        <button
                          type="button"
                          onClick={() => setSelectedRuleIdx(idx)}
                          className={cn(
                            "w-full border p-2.5 text-left transition-colors cursor-pointer",
                            isFocused ? "border-amber/70 bg-amber/[0.07]" : "border-line bg-panel hover:border-line-strong",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-[11px] text-paper">{rule.field}</span>
                            <span
                              className={cn(
                                "shrink-0 border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em]",
                                ACTION_COLOR[rule.action],
                              )}
                            >
                              {rule.action}
                            </span>
                          </div>
                          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{rule.detail}</p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Column 3: Resulting Upstream Payload / Rejection */}
              <div className="p-4 @lg:p-5 @3xl:col-span-4">
                <div className="mb-2.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em]">
                  <span className="text-paper">03 · {activeCase.outputLabel}</span>
                </div>
                <CodeBlock code={activeCase.upstreamOutput} lang="json" showLineNumbers={false} />

                <div className="mt-4 border-t border-line pt-3">
                  <p className="label text-faint">Return Stream / Event Frame Order</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeCase.sseSequence.map((ev) => (
                      <span
                        key={ev}
                        className="border border-line bg-ink px-2 py-1 font-mono text-[10px] text-muted"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* COMPLETE CAPABILITY & REJECTION LEDGER */}
      <section className="py-6 @lg:py-8">
        <Container>
          <div className="grid gap-10 @3xl:grid-cols-12">
            <div className="@3xl:col-span-7">
              <p className="label text-amber">Gateway Endpoint Matrix (from server.c)</p>
              <h2 className="display mt-2 text-2xl text-paper @lg:text-3xl">
                Every HTTP path implemented by the host.
              </h2>

              <div className="mt-5 overflow-x-auto border border-line">
                <table className="w-full min-w-[560px] border-collapse text-left font-mono text-[11.5px]">
                  <thead>
                    <tr className="border-b border-line-strong bg-panel text-[10px] uppercase tracking-[0.14em] text-faint">
                      <th className="px-3.5 py-2.5">Method & Path</th>
                      <th className="px-3.5 py-2.5">Mode</th>
                      <th className="px-3.5 py-2.5">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {[
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
                    ].map(([endpoint, mode, note]) => (
                      <tr key={endpoint} className="hover:bg-paper/[0.02]">
                        <td className="px-3.5 py-2.5 text-paper">{endpoint}</td>
                        <td
                          className={cn(
                            "px-3.5 py-2.5",
                            mode === "Translated"
                              ? "text-amber"
                              : mode.includes("501")
                                ? "text-rust"
                                : "text-moss",
                          )}
                        >
                          {mode}
                        </td>
                        <td className="px-3.5 py-2.5 font-sans text-[12.5px] text-muted">{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="@3xl:col-span-5 space-y-5">
              <div className="border border-rust/40 bg-rust/[0.05] p-5">
                <p className="label text-rust">CLI Compatibility Warning</p>
                <h3 className="mt-2 font-serif text-2xl text-paper">
                  Mock qualification ≠ real-model certification.
                </h3>
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
                  Pinned <strong className="text-paper">Codex CLI 0.167.0</strong> (text + local{" "}
                  <code className="font-mono text-[12px]">exec_command</code>) and{" "}
                  <strong className="text-paper">Claude Code CLI</strong> (streaming text + local Read tool) passed
                  isolated tests against a deterministic mock backend. Compatibility with real inference models and
                  full CLI toolchains remains <strong className="text-rust">unverified</strong>.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <RouteLink to="/status" className="btn btn-outline">
                    See Full Qualification Matrix →
                  </RouteLink>
                </div>
              </div>

              <div className="border border-line bg-panel p-5">
                <p className="label text-faint">Explicitly Unsupported Across Adapters</p>
                <ul className="mt-3 space-y-2 text-[13px] text-muted">
                  <li className="flex gap-2"><span className="font-mono text-rust">×</span> Hosted server tools (<code className="font-mono text-paper">web_search</code>, server-side execution)</li>
                  <li className="flex gap-2"><span className="font-mono text-rust">×</span> Multimodal image, audio, or document inputs in Messages/Responses</li>
                  <li className="flex gap-2"><span className="font-mono text-rust">×</span> Stateful Responses (<code className="font-mono text-paper">store: true</code>, <code className="font-mono text-paper">previous_response_id</code>)</li>
                  <li className="flex gap-2"><span className="font-mono text-rust">×</span> Native Anthropic thinking blocks, prompt caching, and token counting</li>
                </ul>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
