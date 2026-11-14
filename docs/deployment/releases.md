# Releases and platform support

GitHub Actions packages **YAG Host** and **YAG Desktop** from the same
reviewed commit.

- **Linux Host:** native `yag-linux-x86_64.tar.gz` (dynamic glibc/libcurl
  dependencies), plus the bundled React administration Console and docs.
- **Windows Desktop:** unsigned NSIS `.exe` installer.
- **Linux Desktop:** unsigned `.deb` installer.
- **macOS Desktop:** unsigned `.dmg` disk image built on `macos-latest`
  (currently an ARM64 runner).

The `Package and release YAG` workflow also runs weekly on Monday and can
be started manually from GitHub Actions. These runs upload downloadable
**workflow artifacts**, retained for 14 days. They do **not** create tags or
publish releases automatically.

## Publish a versioned GitHub Release

Tag a reviewed and tested commit with `vMAJOR.MINOR.PATCH`:

```sh
git checkout main && git pull --ff-only
git tag v0.2.0
git push origin v0.2.0
```

Replace the example tag with the actual version. On a version tag the
workflow compiles and tests the Host and all three Desktop installers. The
release-publishing job executes **only after every build succeeds** and
attaches all packages and a single `SHA256SUMS.txt` file. It verifies every
checksum immediately before publication. Version tags also require a
Sigstore-signed build provenance attestation for each released file,
created with `actions/attest@v4` via GitHub's short-lived OIDC identity.
If attestation fails, publication is blocked. The workflow can safely update
assets on an existing release tag, but cannot publish a tag that does not
exist.

The Host Linux archive is **not** a Windows or macOS native server build.
For a cross-platform central server, use the separate Docker/Compose
deployment described in [Docker deployment](docker.md) and
[LAN hub](lan-hub.md). YAG Desktop itself is an optional native client.

### Verify tagged release provenance

Download `SHA256SUMS.txt` and the requested release package from a
trusted repository release page. Verify both the checksum and the GitHub
build-provenance attestation against this repository:

```sh
sha256sum --check SHA256SUMS.txt
gh attestation verify yag-linux-x86_64.tar.gz --repo oakvx/yag
```

For Desktop packages, replace the second filename with the actual
downloaded .deb, .exe or .dmg. Provenance binds a file digest to the
repository and workflow identity. It does not prove that a binary is free
of bugs, malicious source changes or model incompatibility.

### Verify and stage a versioned Host rollback (offline)

**Before any rollback**, download all four assets and `SHA256SUMS.txt` from the
specific reviewed tag into a single private directory. Fetch the checksums
and Sigstore attestations through a trusted GitHub connection. Never treat an
untrusted checksum file as an authenticity guarantee.

```sh
# Change both paths and the tag to the actual reviewed release.
python3 scripts/release_verify.py --release-dir "$HOME/yag-releases/v0.2.0" --tag v0.2.0
gh attestation verify "$HOME/yag-releases/v0.2.0/yag-linux-x86_64.tar.gz" --repo oakvx/yag

# A NEW, private, operator-owned parent directory is required.
mkdir -m 700 -p "$HOME/yag-rollbacks"
python3 scripts/release_verify.py \
  --release-dir "$HOME/yag-releases/v0.2.0" --tag v0.2.0 \
  --stage-host "$HOME/yag-rollbacks/v0.2.0"
```

The verification tool requires the *complete* four-package manifest,
rejects tampered files and symlinks, and inspects every Host archive member
before staging. Extraction rejects links, devices, traversal, duplicates and
oversized contents. Staged scripts are private; only the `yag` executable
receives execute permission. An existing staging directory is never
overwritten. The tool does **not** connect to a provider, restart a service
or replace live configuration.

For a planned rollback, stop new inference traffic, take and verify a fresh
encrypted configuration backup (see `scripts/lan_recovery.py`), stop the
existing Host, and deploy the staged, reviewed version through your normal
service manager. Restore the matching configuration only when schema and
credential compatibility have been reviewed. Start with a single-PC smoke
test and verify health, client permissions, model discovery, streaming and
GPU telemetry before reopening traffic. Keep the previous installation
intact until a successful rehearsal; do **not** copy staged files directly
over a running binary.

**Not covered:** rollback of containers, database/schema migrations, Ollama
weights, Windows/macOS installers or live Colibri acceptance. Those require
their own deployment-specific backup and recovery rehearsal. A successful
unit test is not proof that a production rollback was performed.

### Security and operational limits

Desktop installers are currently **unsigned at the operating-system
level** (no Authenticode signing or Apple notarization is configured).
GitHub's Sigstore provenance attests the release file digest and workflow;
it is not an Authenticode signature or a notarized macOS application. The
SHA-256 manifest detects accidental or malicious file changes only when
you obtain the expected checksum from a trustworthy source; it does not
establish publisher identity.

GitHub-hosted CI tests the code and uses mocks; it does not verify GPU
performance, driver compatibility or real-model tool use on Colibri.
For an opt-in self-hosted real-model workflow and remaining integration
limits, see [GitHub Actions operations](../operations/github-actions.md).

No production security or performance guarantee is implied by successful
packaging.
