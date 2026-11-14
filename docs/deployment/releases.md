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
