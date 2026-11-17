# Security model and limits

The development agent has shell and file write access. Heirloom therefore does not try to make forged approvals impossible. It aims to make them **detectable and auditable**.

## Judgment signatures

- The dashboard signs each judgment with a per-user ed25519 key.
- The signature covers:
  - the judged source state, head commit, material hashes, draft digest and probe run hash,
  - per question: the prediction or answer, what was revealed, the hashes of the probe outputs it rests on, the verdict, the reason, spec choices and records kept,
  - the behavior descriptions as edited, the spec lifetime and the confirmed discussions,
  - the prediction and judgment times and the approver (key fingerprint and git user).
- The signature is verified before records are written, the PR paragraph is built or the commit status is posted. In these cases the handoff is treated as not judged, and nothing is written:
  - the signature is missing or wrong,
  - the draft changed after the judgment.
- Predictions are saved before anything is revealed, and the server does not send observed values until then.
- The private key is kept in the first available of:
  1. the macOS keychain,
  2. Linux `secret-tool` (when a D-Bus session is available),
  3. `~/.heirloom/keys/private.key` (mode 0600).
- Old public keys stay in `keys/public/` when the key changes, so past approvals can still be verified.

## Dashboard server

- Binds to `127.0.0.1` only. Other computers cannot connect.
- Rejects requests whose `Host` or `Origin` is not the dashboard address. It sends no CORS headers and rejects cross-site requests (`Sec-Fetch-Site: cross-site`).
- Requests that change state (predict, judge, discard) need a session token. The server creates the token in memory at start and never writes it to disk.
- The page uses a strict Content Security Policy that blocks inline scripts.

## Probe runs

A probe run executes the commands of the agent's probes file, the test command and the setup commands, once on the base and once on the head of the change.

- They run without a shell, in temporary worktrees outside the repository (removed afterwards), with your user's permissions. The network is not limited.
- The commands are recorded with their outputs in `~/.heirloom/tasks/<taskId>/probes/`, so you can see what ran.
- A probe that runs too long is killed with its process group (`timeoutSeconds`, default 30).

## Known limits

A program running as the same OS user, such as the development agent itself, can bypass this:

- **Reading the key file.** When the private key is kept in a file, a program running as the same user can read it and forge approvals. A keychain reduces this risk but does not remove it.
- **Judging through the dashboard.** A program running as the same user can load the dashboard page, take the session token, and call the prediction and judgment API.
- **Reading outputs before predicting.** Probe outputs are on disk under `~/.heirloom/tasks/<taskId>/probes/` from the moment they run. Hiding them in the dashboard keeps a human honest, not a program.

These limits concern deliberate bypasses. For detection, Heirloom keeps:

- **An audit log.** For every judgment request, the dashboard server logs the `User-Agent` and `Sec-Fetch-*` headers to `~/.heirloom/server/server.log`. This helps spot requests that did not come from a browser. Headers can be forged, though, so the log alone is not proof.
- **Key fingerprints.** Judgment records and the repository's decision records include the signing key fingerprint. Review the `.heirloom/` changes as part of the PR.
- **Commit status.** `heirloom/understood` is posted with your `gh` or `glab` login. Anyone with write access to the repository can post a status of the same name; a status is a signal on the PR, not proof of a judgment.

## Recommendations

- Use a keychain where one is available. This is the default.
- Do not instruct the agent to read or write `~/.heirloom/` directly.
- If the agent reports something as judged that you did not judge, check `server.log` and the judgment record times.
