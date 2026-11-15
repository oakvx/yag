# First release: staged candidate and Colibri acceptance

YAG's first public version should be a **release candidate** until hardware,
model, credential and operator acceptance are actually demonstrated. A green
GitHub-hosted build proves compilation and mock integration, not real inference.

## Included in the candidate

- C17 gateway, constrained HTTP parser, per-PC scoped keys and revocation.
- Ollama model management, provider pool configuration and local React Console.
- Chat Completions, the documented Responses subset and Anthropic-compatible
  client adapter (not a native Anthropic upstream API implementation).
- FIFO/key-aware scheduler, bounded inference concurrency and optional NVML
  observations. Unsupported sensors appear as unavailable.
- Docker LAN TLS endpoint with Caddy, encrypted configuration backups via age
  and a non-overwriting, checksum-verified Linux Host rollback stage.
- Optional Desktop for Windows/macOS/Linux; installer binaries **unsigned**
  until OS-specific publisher identities and notarization exist.
- A manually triggered real-model qualification workflow on trusted Colibri.

There is **no** native encrypted-at-rest live BYOK vault, guaranteed financial
spend limit, independently audited public admin API or full automatic model
capability discovery. Cloud inference sends content to the selected third party.
Dedicated model IDs require explicitly scoped workstation access.

## Candidate checks (can run on GitHub-hosted CI)

1. Required CI, C ASan/UBSan, Docker/HTTPS, offline Console Chromium smoke,
   CodeQL/actionlint and Desktop Linux/macOS/Windows tests must pass.
2. The packaging workflow must produce the Host and all three Desktop formats,
   verify SHA-256 and stage the Linux Host from a fresh directory on a tag.
3. Tag a **reviewed** main commit using `v0.1.0-rc.1` (or a newer reviewed
   candidate version). CMake builds numeric `0.1.0`; the Desktop versions
   retain the prerelease suffix.
4. On a tag, `release.yml` creates a **GitHub prerelease**, including
   provenance attestations and checksum manifest. No unattended weekly
   publication occurs. Never treat prerelease packaging as a production pass.

## Mandatory production acceptance — cannot be simulated

Only on **Colibri**, using a trusted `yag-colibri` self-hosted Linux runner:

1. Set the reviewed `YAG_REAL_UPSTREAM_URL` variable (loopback Ollama or an
   explicitly trusted HTTPS backend). Set an upstream key only if required.
   Configure the protected `local-inference` environment and isolated,
   least-privileged runner account. Do not run PR code on this machine.
2. Configure repository variable `YAG_REAL_OLLAMA_NATIVE_URL` for the exact
   Ollama instance serving the OpenAI-compatible `YAG_REAL_UPSTREAM_URL`.
   Use its **loopback** native origin, for example `http://127.0.0.1:11434`.
   The script queries `/api/tags` directly with no proxy and records the
   SHA-256 of the exact model manifest. Mismatched names, invalid digests,
   non-loopback URLs and unavailable catalogs are **not** treated as verified.
3. Use **Actions → Qualify a real model on Colibri** on `main`, with
   `protocol=all`, `tools=true`, `stream=true`, and
   `release_candidate=true`. The model must actually support those features.
4. The probe creates a metadata-only `qualification.json` (schema 3):
   Git commit, model ID SHA-256, UTC timestamp, OS/architecture, optional
   Ollama CLI version, optional NVIDIA model/driver/VRAM and protocol results.
   It contains no prompts, model text, bearer keys or upstream URLs.
5. Download the workflow artifact **from that trusted run** and review:

   ```sh
   python3 scripts/release_gate.py --evidence qualification.json --commit FULL_40_CHARACTER_MAIN_COMMIT_SHA --require-model-digest
   ```

   This check requires 3 successful protocols, actual tool replay, SSE,
   matching commit, fresh evidence (30 days maximum) and NVIDIA GPU
   information measured with `nvidia-smi`.
6. Run the opt-in two-credential acceptance harness on the **real**
   running LAN gateway with a locally installed text model:

   ```sh
   python3 scripts/lan.py preflight
   python3 scripts/lan_acceptance.py --model llama3.2:latest \
     --report-json /private/path/new-lan-acceptance.json
   ```

   The selected model ID is illustrative. This executes up to four small
   **real** inference requests: two simultaneous scoped client requests,
   a streaming request closed on the client, and a follow-up request. It
   verifies TLS trust, both clients' model discovery, refusal of anonymous
   access, Caddy admin isolation and the gateway's response after stream
   closure. No provider prompt/output/API key is written to the JSON.
   Ensure Colibri has sufficient spare capacity; this is operator-triggered,
   not an automatic public CI task.

7. Test multiple **physical** PCs, actual upstream cancellation and GPU load, scope revocation, deliberate outage and recovery,
   device driver telemetry and actual fallback behavior. Rehearse backup
   decrypt/stage and verified Host rollback on a replacement machine.
7. Have an independent reviewer assess key storage, cloud egress, TLS/CORS,
   endpoint isolation, release artifacts and signing/notarization status.
   Confirm actual provider pricing, quotas and data-processing policies.

The qualification JSON is **not a cryptographic attestation**. Check the
workflow run identity and runner assignment, review the exact commit and
retain the authenticated CI URL and non-secret operator notes. The model ID hash is **not** a model revision. Schema 3 records an Ollama
manifest SHA-256 from the native API, and stable releases require it. It
identifies the observed manifest but is not a cryptographic attestation that
the separately configured OpenAI-compatible endpoint uses exactly those
weights. The operator must validate the endpoint/runtime pairing and the
full model revision separately. Record the Ollama version, model digest and
hardware in private deployment notes.

## Stable release protection

A plain `vMAJOR.MINOR.PATCH` tag is not enough to publish a stable release.
The release job additionally checks repository variable
`YAG_STABLE_RELEASE_APPROVED=true` and targets the
`production-release` GitHub Environment. Configure required reviewers and
branch/tag deployment protections there; do not enable that variable until
actual Colibri qualification and the applicable security gates have passed.
A prerelease uses the separate `release-candidate` environment.

### Mandatory authenticated Colibri workflow run for stable tags

In addition to protected-environment reviewer approval and
`YAG_STABLE_RELEASE_APPROVED=true`, provide the **numeric run ID** of a
successful, manually dispatched `Qualify a real model on Colibri` workflow
in `YAG_STABLE_QUALIFICATION_RUN_ID` (prefer the `production-release`
GitHub Environment variable). The stable publication job:

1. Retrieves the workflow-run and job metadata using its limited GitHub
   Actions read permission; no arbitrary URLs are accepted.
2. Requires exactly the reviewed release commit on `main`, a successful
   workflow dispatch, the expected workflow path, the labeled
   `self-hosted/linux/yag-colibri` runner and successful full
   `release_candidate` qualification step.
3. Downloads the metadata-only artifact from that run and validates its
   SHA-256 model ID, protocol/tool/SSE pass results, same commit, fresh
   UTC date, reported NVIDIA GPU/driver inventory and the exactly matched
   Ollama model manifest SHA-256.
4. Fails closed before publishing if any condition or artifact is missing.

This keeps a stale, generic mocked or unqualified workflow artifact from
silently authorizing a stable release. It does **not** prove the runner's
physical identity beyond GitHub's labels, verify an Ollama model digest,
substitute for a real recovery rehearsal or conduct independent security
review. The operator must verify those separately and only then approve
the protected environment.

The variable is an **explicit operator approval**, not cryptographic proof
of evidence. The release workflow cannot independently confirm third-party
security review, physical restore drills, valid signing certificates or
publisher credentials. If those gates are not met, keep the first version a
clearly labelled release candidate rather than claiming general readiness.

See [go-live](go-live.md), [release verification](../deployment/releases.md)
and [GitHub Actions](github-actions.md).
