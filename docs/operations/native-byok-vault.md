# Native Host BYOK vault (POSIX, encrypted at rest)

This workflow uses the audited external **age CLI** for encrypted private
provider aliases, not a home-grown cipher. It is an opt-in alternative to
plaintext \`.env.lan\` **for the native YAG Host executable only**. It does
not secure Docker Compose environment persistence or an already running
process's memory. No browser key storage or network administration endpoint.

## Initialize a private operator folder

Use a dedicated non-root service account with a secure home directory.
Install \`age\` / \`age-keygen\` from your OS package manager. Do not keep
the identity or vault in the repository or commit either file.

\`\`\`sh
mkdir -p "$HOME/.config/yag"
chmod 700 "$HOME/.config/yag"
age-keygen -o "$HOME/.config/yag/identity.txt"
chmod 600 "$HOME/.config/yag/identity.txt"
\`\`\`

The \`age-keygen\` output shows a public \`age1...\` recipient. Substitute
that **public** recipient below. The identity file contains the **private**
decryption key and must be stored securely with a separate recovery copy.

\`\`\`sh
python3 scripts/provider_vault.py init \
  --vault "$HOME/.config/yag/providers.age" --recipient "age1..."
python3 scripts/provider_vault.py set \
  --vault "$HOME/.config/yag/providers.age" \
  --identity "$HOME/.config/yag/identity.txt" \
  --recipient "age1..." --alias YAG_POOL_KEY_1
python3 scripts/provider_vault.py list \
  --vault "$HOME/.config/yag/providers.age" \
  --identity "$HOME/.config/yag/identity.txt"
\`\`\`

\`set\` requires a real terminal and asks for the key with hidden input. It
never accepts the secret on the command line, writes it as plaintext in a
file, or prints it. Up to eight aliases are supported. Only the alias
names, not values, are printed by \`list\`. The vault file must be owned by
the caller, regular, not a symlink or hardlink, and mode 0600; its parent
must be an owned 0700 directory. The private identity must also be 0600.
Windows is unsupported for this native-only mechanism.

## Start the native gateway

\`\`\`sh
export YAG_API_KEY="$(openssl rand -hex 32)"
export YAG_UPSTREAM_URL='http://127.0.0.1:11434/v1'
python3 scripts/provider_vault.py exec \
  --vault "$HOME/.config/yag/providers.age" \
  --identity "$HOME/.config/yag/identity.txt" \
  --host "/absolute/path/to/build/yag"
\`\`\`

The launcher decrypts into its **process memory**, removes unrelated
\`YAG_POOL_KEY_1..8\` variables, then uses \`execve\` to start **only**
the native binary named \`yag\` with the configured aliases. It does not
launch shell commands. The Host can then use these aliases in its existing
private provider configuration. Configure scoped dedicated HTTPS models,
and do not route paid providers through unrestricted static routes.
Changing the vault requires a Host restart to apply new keys.

## Rotate or retire an alias

\`\`\`sh
python3 scripts/provider_vault.py rotate \
  --vault "$HOME/.config/yag/providers.age" \
  --identity "$HOME/.config/yag/identity.txt" \
  --new-recipient "age1-NEW-PUBLIC-RECIPIENT"
python3 scripts/provider_vault.py clear \
  --vault "$HOME/.config/yag/providers.age" \
  --identity "/path/to/NEW-identity.txt" \
  --recipient "age1-NEW-PUBLIC-RECIPIENT" \
  --alias YAG_POOL_KEY_1
\`\`\`

\`rotate\` re-encrypts the aliases with the new recipient using a private
same-directory atomic replacement. Verify that you can decrypt with the
**new identity** before destroying the old identity. The provider-issued
secret itself is not rotated by re-encrypting the vault: rotate it at the
cloud provider and then update the alias with \`set\`. Revoke removed
provider secrets in their provider dashboard.

## Precise security boundaries

- Ciphertext is encrypted at rest with \`age\`; provider values are present
  in launcher memory and the native Host's inherited environment. Other
  processes with sufficient OS permissions (e.g. the same UID or root on
  some Linux configurations) can inspect environment or process memory.
  Use a dedicated, locked-down service account, protected backups and
  full-disk encryption for additional defense.
- **Do not use \`provider_vault.py exec\` to launch Docker/Compose.** Docker
  environment entries can be inspected through container metadata and may
  persist in engine state on disk. \`YAG_POOL_KEY_n\` in \`.env.lan\` remains
  plaintext in the current Compose deployment. Use an external secret
  manager or a properly designed secret mount/decryption mechanism there.
- This does not encrypt model prompts, gateway/client API keys or the
  runtime-managed provider registry. It is **not** the final full native
  and containerized live credential vault from production issue #48.
- Secret material is never sent through the browser. The private operator
  identity, provider keys and vault are not uploaded to CI or GitHub.

See [cloud provider setup](cloud-providers.md) and
[first release gates](first-release.md).
