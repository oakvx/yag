# Automated builds, checks and hardware qualification

GitHub Actions orchestrates YAG's repeatable builds and tests. It cannot emulate
Colibri's GPU, safely discover a private LAN, or prove that a specific real
inference model supports an agent protocol. Those checks run only on a
**trusted, opt-in self-hosted runner**.

## Automation overview

| Workflow | Trigger | Output |
| --- | --- | --- |
| `ci.yml` | PR + main/feature pushes | C17 host tests, address/undefined behavior sanitizers, Console build, Docker/LAN checks, mock CLI protocol probes |
| `desktop.yml` | Desktop PRs + main changes | Native Linux .deb, Windows NSIS .exe, macOS .dmg build artifacts |
| `security.yml` | PR + main + Wednesday + manual | actionlint, CodeQL C/C++ and JS/TS scans, Console and Desktop npm vulnerability audits |
| `release.yml` | Manual + `v*` tags | Host Linux package and all three Desktop installers. Attaches each to workflow artifacts. A reviewed tag publishes a GitHub Release with SHA-256 checksums and signed provenance |
| `weekly-release.yml` | Monday 06:17 UTC + manual on `main` | Checks the exact main commit's latest CI/security runs, creates one immutable `vX.Y.Z-weekly.YYYYMMDD` tag per UTC week and dispatches signed prerelease packaging |
| `live-model.yml` | Explicit manual dispatch on `main` only | Qualifies a **real** model with an isolated gateway on a self-hosted Linux runner |
| `prepare-rc.yml` | Manual dispatch from reviewed `main` | Checks exact-commit CI/security runs, creates a new `-rc.N` tag without overwriting and explicitly dispatches tagged packaging |

Workflow checks do not issue credentials or add secrets to repository files.
The GitHub Dependency Review API is not enabled on this repository; the
security workflow instead performs package-manager audits directly on its
runners. To add GitHub's native PR dependency review later, enable
Dependency Graph in repository security settings.
Tagged releases now require a separate signed provenance attestation
job for every verified Host/Desktop artifact. If Sigstore or GitHub
attestation storage is unavailable, the release-publishing job remains
blocked. No long-lived publisher certificate is used for provenance;
Windows/macOS installers remain **unsigned by their operating systems**.

**One-click prerelease:** the default `GITHUB_TOKEN` does not start
ordinary tag-push workflows when it creates a tag. `prepare-rc.yml`
therefore explicitly uses `workflow_dispatch` on the new tag reference
to start `release.yml`. Manual dispatch against `main` only builds
artifacts; tag dispatch publishes a prerelease after checks and attestations.
Use protected `release-candidate` / `production-release` Environments. Weekly snapshots publish through the separate `weekly-prerelease` Environment without production approval; the publishing job independently re-verifies exact-main CI/security evidence.

`weekly-release.yml` now **publishes a public experimental GitHub prerelease each Monday**, not merely a 14-day workflow artifact. It uses the date of that week's UTC Monday in the immutable tag, including when manually dispatched. Re-running the same week skips an already published release from the same commit; it refuses a conflicting tag rather than moving it. If initial packaging fails after tag creation, a run may dispatch packaging against the original tag without moving it. CI/security failures block the tag. The tagged release job repeats that verification, then requires four packages, SHA-256 checks and Sigstore provenance before publication. GitHub may delay a scheduled run.

No weekly run publishes a stable version or satisfies real Colibri acceptance. Unsigned Desktop packages may display macOS/Windows trust warnings. Non-release workflow artifacts still expire after 14 days.

For first-release candidate qualification choose `release_candidate=true` together with `protocol=all`, `stream=true` and `tools=true`. The workflow validates a metadata-only report against the exact commit and measured GPU inventory. The gate does not authenticate the runner or independently certify the selected model. See [first-release acceptance](first-release.md).

## Set up Colibri for real-model qualification

Only do this if Colibri runs Linux and you control the hardware. Set up a
GitHub Actions self-hosted runner under an unprivileged dedicated account with
labels `self-hosted`, `linux`, and `yag-colibri`. Keep it on a trusted network
and allow it to reach the intended local inference backend, for example
Ollama at `http://127.0.0.1:11434/v1`.

Never install this runner with administrator privileges, give it access to
the Docker socket unless strictly necessary, or allow public untrusted PRs
to execute jobs on it. The workflow is restricted to `main` and uses a
read-only checkout. Configure runner host updates and network ACLs outside
GitHub Actions.

Install Python 3, CMake, a C17 compiler, and the system libcurl development
headers on this runner. Set:

- **Repository variable:** `YAG_REAL_OLLAMA_NATIVE_URL` is the loopback
  native Ollama API origin, e.g. `http://127.0.0.1:11434`. Stable
  qualification requires an exact model digest from its `/api/tags` endpoint.
  Verify the native API and OpenAI-compatible inference service are the
  **same** Ollama instance; the CI cannot independently prove this mapping.
- **Repository variable:** `YAG_REAL_UPSTREAM_URL` with the private Ollama
  OpenAI-compatible URL ending in `/v1`. The existing probe requires HTTPS
  when the upstream is not loopback.
- **Optional GitHub Actions secret:** `YAG_REAL_UPSTREAM_KEY` only if the
  inference provider needs bearer credentials. For local Ollama leave it
  unset; never distribute the YAG administrator key.
- **Environment:** `local-inference`. Ideally require manual approval for
  this environment and restrict it to the `main` branch.

Navigate to **Actions → Qualify a real model on Colibri → Run workflow**.
Choose the exact installed model ID, the protocol, and whether to require
streaming and function calling. Enabling tools is intentionally opt-in: not
every model can generate valid function calls.

An explicitly run Colibri qualification uploads a sanitized JSON artifact
(`yag-real-model-qualification`, retained for 14 days) containing the commit
SHA, a model-ID fingerprint and protocol-level results. No provider URL,
prompt, output or secret is included; nevertheless, access to CI artifacts
must be restricted because model fingerprints can be guessed for public IDs.

The workflow builds YAG locally, starts it bound only to localhost with a
random temporary key, calls the real inference backend, and exits. The
qualification fixture does not execute an external tool or print actual
prompts, model outputs, or credentials. Results indicate compatibility for
that **exact model and runtime combination**.

If you point `YAG_REAL_UPSTREAM_URL` at a hosted provider, requests may incur
charges and leave the LAN. No hosted provider is configured by default.

## Before publishing a release

1. Merge changes after the required CI/security checks.
2. Confirm at least one successful native Desktop and Linux Host build.
3. Tag the reviewed commit with `vMAJOR.MINOR.PATCH`.
4. Wait for `Package and release YAG` to pass all four builders before
   relying on the published assets and `SHA256SUMS.txt`.
5. Independently test the unsigned installers and gateway on intended
   operating systems and hardware.

A passing CI run is **not** a third-party security audit, Apple/Windows GPU
telemetry validation, signed installer, or proof of full Codex/Claude Code
compatibility with arbitrary real models.

Cloud API key aggregation (Gemini/OpenAI/Anthropic BYOK), an OpenRouter-style
model catalog, sophisticated cross-provider policy routing, and cost controls
remain product features to implement separately. GitHub Actions can test,
package, and release those components once their code exists.
