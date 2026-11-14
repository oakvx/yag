# Dependency update policy

The project uses Dependabot for **proposed updates**, not automatic dependency
merges. Unreviewed upstream releases must never be deployed just to make the
Pull Requests page empty.

## PR limits

- **GitHub Actions**: one grouped version-update PR, checked on Monday.
- **Console npm**: one grouped version-update PR, checked on Tuesday.
- **Desktop npm**: one grouped version-update PR, checked on Wednesday.
- **Desktop Rust/Cargo**: one grouped version-update PR, checked on Thursday.
- **Security advisories**: separate groups per ecosystem. These do not share
  the version-update PR limit, so they can still be reported promptly.

The schedule uses the Europe/Rome timezone. GitHub may queue runs, so the
actual start time can vary.

An ecosystem's grouped PR can contain **major version changes**. This
reduces queue noise but does **not** establish compatibility. Before merge,
inspect the release notes, dependency lockfile, native platform build,
Console build, CodeQL, tests and any workflow changes. Never enable
unconditional Dependabot auto-merge.

## Handling PRs created before grouping

Individual update PRs opened before this policy may remain in GitHub.
Close them **only when superseded and tracked**, not because their
dependencies are necessarily upgraded. A manually closed Dependabot PR
may not be recreated for the identical version immediately. Record each
outstanding dependency and original PR link in a maintenance issue, then
review the next grouped update; do not assume that a green build means
every transitive change is safe.

Security vulnerabilities must be assessed independently, including
whether a fix requires a major version update. Keep GitHub Actions
and runtime dependency scanners active; don't ignore vulnerable versions
to force a green result.

## Reviewing a grouped update

1. Compare versions against the current main branch.
2. Review upstream breaking changes and lockfile diffs.
3. Confirm all supported platform builds (Windows, macOS and Linux for
   Desktop, Linux for the Host) and API/Console tests.
4. For a dependency with native or network behavior, check the specific
   security impact (TLS, redirects, proxy handling, token privacy).
5. Merge only after the relevant tests pass and the changes are understood.

You can reopen a previously closed PR or create an explicit upgrade PR
when it cannot be safely included in a grouped update.
