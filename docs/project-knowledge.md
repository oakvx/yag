# Project knowledge used by the public YAG site

Reviewed on 15 November 2026 against `oakvx/yag` main at
`0d97615e04afb17166ad6499352e091a00552efe`.
The local application worktree was not merged or reset to update this knowledge.

## Reading and navigation

The user's reference is an open document: a clear introduction, readable sections,
and tools next to their explanation. Informational pages must not start as a
directory of hidden explanations. Use the shared document layout and an in-page
index. Source Explorer has search, a subsystem filter, a file list, an exact source
excerpt and engineering notes; it becomes a single column on mobile.

## Current implementation

- Host: C17/POSIX with libcurl and vendored yyjson. Native TLS and an independent
  security audit remain absent. One request per connection; bounded headers,
  bodies, deadlines and workers. Body defaults differ between standalone and LAN.
- Protocols: transparent OpenAI-compatible paths and bounded Responses/Messages
  adapters. Tools execute in clients. Mock CLI probes do not qualify real models.
- Clients: browser operator Console and optional Windows/macOS/Linux Desktop.
  Desktop connects to a remote Host and offers opt-in local history and a temporary
  authenticated localhost API; it does not run models.
- Credentials: private managed-client storage supports live issuance and
  revocation. Static bootstrap environment keys still require restart rotation.
- Providers: up to eight replicas with declared model policies and private live
  management. Pool edits require no active/waiting pool work. Exact-model static
  routes and the primary upstream remain startup configuration.
- Pool admission: concurrency limits, estimated VRAM reservations, dedicated
  model policies and per-run request reservations. These are not financial
  budgets, measured remote GPU usage or model capability verification.
- Adaptive admission: `host/src/core/scheduler.c` and `gpu_probe.c` implement
  optional measured GPU-aware admission via Linux DRM/sysfs and dynamically
  loaded NVIDIA NVML. Missing VRAM sensors retain the static cap. The calculated
  capacity keeps at least one slot and cannot guarantee freedom from backend OOM.
- Audit: optional private administrative JSONL response events omit prompts,
  credentials, IP addresses and client identities. No tamper-evident identity
  audit or persistent inference history is implied.
- Packaging: reviewed Host/Desktop workflows, checksums, provenance and separate
  candidate/stable gates. Latest main fixes checkout before rollback staging
  verification. Packaging does not establish production readiness.
- CMake registers 21 conditional CTest suites at this revision. This is a source
  count, not a claim that native suites were executed during the website update.

## Source precedence

Some older paragraphs in `docs/architecture/STATUS.md` and README still describe
NVML/adaptive scheduling as absent. The implementation and the updated adaptive
section in `docs/operations/control-plane.md` establish the narrower current
behavior above. Do not repeat the older blanket claims. Keep adaptive measured
admission separate from estimated per-replica reservations.

## Reproducible updates

1. Fetch the public main branch without changing the current worktree:
   `git fetch origin main`.
2. Review source and operational documentation at the fetched commit.
3. Run `node scripts/sync-project-knowledge.mjs --ref=origin/main`.
4. Review `src/data/projectKnowledge.ts`, source descriptions and page claims.
   The generator updates exact bytes and ranges, not semantic prose.
5. Run `node scripts/sync-project-knowledge.mjs --check --ref=origin/main`.
6. Regenerate the notification feed with `node scripts/console-commits.mjs`.
   It uses the reviewed snapshot revision by default.
7. Run TypeScript, build and the reading/source browser checks.

All 13 Source Explorer excerpts are contiguous ranges from Git, with pinned
links and original line numbers. Simulators remain illustrative browser-only
examples; their controls do not contact or administer a live Host.
