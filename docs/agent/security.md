# Security model and limits

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

## Headless curation runs

A [context curation](curation.md) is the only case where Heirloom starts an agent itself, and only after you choose it in the dashboard.

- The command comes from the user setting `curation.agent`. A request to the dashboard cannot choose or change it; the run request must have an empty body, and it needs the session token like an approval.
- The prompt is fixed text: task ID, worktree path and the skill to follow. No request content or record text goes on the command line.
- The agent runs in the dedicated worktree with a limited tool list. Drafting: read tools, writing its `draft.json`, and the curation and submit scripts. Applying: read tools, writing the PR body file, the apply scripts, `git add .heirloom*`, `git commit`, `git push`, `gh pr create` and updating a PR body through the GitHub API (`gh api -X PATCH repos/…/pulls/…`). GitLab merge requests go through the apply script `open-mr.mjs`, so no `glab` command is allowed directly.
- How each profile enforces the list:
  - Claude Code: `--allowedTools`.
  - Codex: `codex exec` without your Codex config (no other hooks, plugins or MCP servers) and with a hook for that run only that denies shell commands and file patches outside the list. Commands must be single commands: `;`, `&&`, `|`, `$(…)` and redirection are denied. Drafting runs in Codex's `workspace-write` sandbox. Applying runs without the sandbox, because the sandbox keeps `.git` read-only and the step must commit; the hook is then the only limit, as `--allowedTools` is for Claude Code.
  - Antigravity: `agy -p` in the default agent mode (not Auto) with permission rules for that run only, and file writes into the worktree denied.
  - Codex and Antigravity have no read tool that covers everything, so they may also run `ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `grep`, `git status` and `git rev-parse`.
- It runs with your user's permissions and your `gh` or `glab` login. A program that can take the dashboard's session token can also start a curation; this is the same level as the approval limit below.

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
