# Security model and limits

[한국어](../ko/security.md)

The development agent has shell and file write access. Heirloom therefore does not try to make forged approvals impossible. It aims to make them **detectable and auditable**.

## Approval signatures

- The dashboard signs each approval with a per-user ed25519 key.
- The signature covers:
  - the approved source state, material hashes and draft digest,
  - the final summary and the decision on each item,
  - the approval time and the approver (key fingerprint and git user).
- The signature is verified before records are written or a PR is opened. In these cases the handoff is treated as not approved, and nothing is written:
  - the signature is missing or wrong,
  - the draft changed after approval.
- The private key is kept in the first available of:
  1. the macOS keychain,
  2. Linux `secret-tool` (when a D-Bus session is available),
  3. `~/.heirloom/keys/private.key` (mode 0600).
- Old public keys stay in `keys/public/` when the key changes, so past approvals can still be verified.

## Dashboard server

- Binds to `127.0.0.1` only. Other computers cannot connect.
- Rejects requests whose `Host` or `Origin` is not the dashboard address. It sends no CORS headers and rejects cross-site requests (`Sec-Fetch-Site: cross-site`).
- Requests that change state (approve, discard) need a session token. The server creates the token in memory at start and never writes it to disk.
- The page uses a strict Content Security Policy that blocks inline scripts.

## Known limits

A program running as the same OS user, such as the development agent itself, can bypass this:

- **Reading the key file.** When the private key is kept in a file, a program running as the same user can read it and forge approvals. A keychain reduces this risk but does not remove it.
- **Approving through the dashboard.** A program running as the same user can load the dashboard page, take the session token, and call the approval API.

These limits concern deliberate bypasses. For detection, Heirloom keeps:

- **An audit log.** For every approval request, the dashboard server logs the `User-Agent` and `Sec-Fetch-*` headers to `~/.heirloom/server/server.log`. This helps spot requests that did not come from a browser. Headers can be forged, though, so the log alone is not proof.
- **Key fingerprints.** Approval records and the repository's record files include the signing key fingerprint. Review the `.heirloom/` changes as part of the PR.

## Recommendations

- Use a keychain where one is available. This is the default.
- Do not instruct the agent to read or write `~/.heirloom/` directly.
- If the agent reports something as approved that you did not approve, check `server.log` and the approval record times.
