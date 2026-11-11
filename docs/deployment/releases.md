# Releases and platform support

Tag a reviewed, tested commit with `vMAJOR.MINOR.PATCH` and push the tag.
The release workflow compiles the Linux x86_64 gateway, builds the Console,
runs CTest and attaches an archive plus SHA-256 checksum to GitHub Releases.

```sh
git checkout main && git pull --ff-only
git tag v0.2.0
git push origin v0.2.0
```

Replace the example tag with the actual version. **Tagging publishes a release**;
it is intentionally not done as part of an ordinary feature PR.

The archive is **not statically linked** and requires a compatible Linux glibc
and libcurl runtime. It is not a Windows or macOS build. For a self-contained
deployment option, build the separate Docker image described in
[Docker deployment](docker.md).

No production security, real-model compatibility or performance guarantee
is implied by a successful packaging workflow.
