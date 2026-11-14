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
2. Use **Actions → Qualify a real model on Colibri** on `main`, with
   `protocol=all`, `tools=true`, `stream=true`, and
   `release_candidate=true`. The model must actually support those features.
3. The probe creates a metadata-only `qualification.json` (schema 2):
   Git commit, model ID SHA-256, UTC timestamp, OS/architecture, optional
   Ollama CLI version, optional NVIDIA model/driver/VRAM and protocol results.
   It contains no prompts, model text, bearer keys or upstream URLs.
4. Download the workflow artifact **from that trusted run** and review:

   ```sh
   python3 scripts/release_gate.py --evidence qualification.json --commit FULL_40_CHARACTER_MAIN_COMMIT_SHA
   ```

   This check requires 3 successful protocols, actual tool replay, SSE,
   matching commit, fresh evidence (30 days maximum) and NVIDIA GPU
   information measured with `nvidia-smi`.
5. Test multiple physical PCs, scope revocation, cancellation, load,
   device driver telemetry and actual fallback behavior. Rehearse backup
   decrypt/stage and verified Host rollback on a replacement machine.
6. Have an independent reviewer assess key storage, cloud egress, TLS/CORS,
   endpoint isolation, release artifacts and signing/notarization status.
   Confirm actual provider pricing, quotas and data-processing policies.

The qualification JSON is **not a cryptographic attestation**. Check the
workflow run identity and runner assignment, review the exact commit and
retain the authenticated CI URL and non-secret operator notes. A SHA-256 of a
model ID does **not** establish a pinned Ollama model revision. Record the
actual runtime version and model digest in private deployment records.

## Stable release protection

A plain `vMAJOR.MINOR.PATCH` tag is not enough to publish a stable release.
The release job additionally checks repository variable
`YAG_STABLE_RELEASE_APPROVED=true` and targets the
`production-release` GitHub Environment. Configure required reviewers and
branch/tag deployment protections there; do not enable that variable until
actual Colibri qualification and the applicable security gates have passed.
A prerelease uses the separate `release-candidate` environment.

The variable is an **explicit operator approval**, not cryptographic proof
of evidence. The release workflow cannot independently confirm third-party
security review, physical restore drills, valid signing certificates or
publisher credentials. If those gates are not met, keep the first version a
clearly labelled release candidate rather than claiming general readiness.

See [go-live](go-live.md), [release verification](../deployment/releases.md)
and [GitHub Actions](github-actions.md).
