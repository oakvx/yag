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
| `security.yml` | PR + main + Wednesday + manual | actionlint, CodeQL C/C++ and JS/TS scans, dependency review on PRs, production npm vulnerability audit |
| `release.yml` | Monday + manual + `v*` tags | Host Linux package and all three Desktop installers. Attaches each to workflow artifacts. A reviewed tag also publishes a GitHub Release with SHA-256 checksums |
| `live-model.yml` | Explicit manual dispatch on `main` only | Qualifies a **real** model with an isolated gateway on a self-hosted Linux runner |

Workflow checks do not issue credentials or add secrets to repository files.
The automated weekly packaging run **does not create tags or publish stable
releases**. Build artifacts expire after 14 days. The Desktop packages are
currently **unsigned**, so macOS/Windows can display trust warnings.

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
