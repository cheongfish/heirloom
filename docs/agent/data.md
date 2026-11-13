# Data locations

Heirloom keeps data in two places. The repository holds only the records a team shares. Task state, approvals and keys stay on your computer.

## In the project: `<repository>/.heirloom/`

Everything here is committed. Task state and approvals are never stored here, so no `.gitignore` entry is needed.

| Path | Content |
| --- | --- |
| `decisions/d-<id>.md` | A decision record: JSON front matter, then the body (problem, choice and reasons, rejected alternatives, scope) |
| `axioms/a-<id>.md` | An axiom record: property to keep, scope and conditions, exceptions, checks |
| `curation/c-<id>.json` | Review history of one [context curation](curation.md): the batch, each candidate with the decision and reason, the other changes |
| `config.json` | Optional. [Project settings](configuration.md#project-settings) |

- **Quoted messages.** A record whose decision was made in the chat keeps the quoted part of the user's message as its source (`"ref": "@conversation"`), so that text is committed with the record.
- **Inactive records.** Superseded and deprecated records are never deleted. They stay with `active: false`, so the history is kept.
- **Do not edit records by hand.** To change one, ask the agent for an update or supersede draft and approve it in the dashboard. Wording changed during PR review counts as it was merged.

## On your computer: `~/.heirloom/`

The environment variable `HEIRLOOM_HOME` changes this location. Directories are created with mode 0700, files with 0600.

| Path | Content |
| --- | --- |
| `config.json` | Optional. [User settings](configuration.md#user-settings) |
| `index.json` | Worktree registry (including the host of each worktree's last session) and the task key → task ID mapping |
| `ids/<hash>/heirloom-repo-id`, `heirloom-worktree-id` | Repository and worktree IDs, only when the repository's `.git` cannot be written (for example in Codex's default sandbox). Normally these IDs live in `.git`. |
| `tasks/<taskId>/input.json` | Input frozen at handoff (source state, materials) |
| `tasks/<taskId>/conversation.json` | The messages the user typed in the session, frozen at handoff for quoting. Messages of later rounds of the task are added; earlier ones stay. |
| `tasks/<taskId>/draft.json`, `draft.initial.json` | The agent's draft and a copy of its first version |
| `tasks/<taskId>/check.json` | Source check result |
| `tasks/<taskId>/handoff.md` | Readable handoff file |
| `tasks/<taskId>/approvals/ap-<id>.json` | Signed approval records |
| `tasks/<taskId>/events.jsonl` | Task event log |
| `tasks/<taskId>/curation.json`, `agent-<step>.log` | Curation tasks only: the dedicated worktree and branch, and the headless run logs |
| `worktrees/<repoId>/<taskId>/` | Dedicated worktree of a running curation. Removed when the curation ends. |
| `sessions/<hash>.json` | Per worktree: the transcript path, first and last hook time of recent sessions (kept for 7 days), and whether the session was told it can hand off work without a spec |
| `keys/current.json` | Fingerprint of the current signing key and where its private key is kept |
| `keys/private.key` | The private key, only when no keychain can be used (mode 0600) |
| `keys/public/<fingerprint>.pub` | Every public key used so far |
| `server/server.json`, `server/server.log` | Dashboard server information and log (including the approval audit lines) |

## What you may delete

| Target | Safe to delete? |
| --- | --- |
| `server/` | Yes, while the server is stopped. It is recreated. |
| `sessions/` | Yes. A handoff right after has no conversation to quote until the next session start or stop. |
| `tasks/<taskId>/` of finished tasks (PR created, discarded, expired) | Yes. The record files in the repository are not affected. |
| `tasks/<taskId>/` of open tasks | No: the handoff and its approval are lost. |
| `worktrees/` | Not by hand: use `git worktree remove` from the repository, or discard the curation in the dashboard. |
| `keys/public/` | No: past approvals can no longer be verified. |
| `ids/` | No: the repository gets new IDs and loses the link to its open tasks. |
| `keys/private.key` or the keychain entry | A new key is created at the next approval. Verifying past approvals needs only the public keys. |
