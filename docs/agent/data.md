# Data locations

Heirloom keeps data in two places. The repository holds only the decision records a team shares. Task state, probe runs, judgments and keys stay on your computer.

## In the project: `<repository>/.heirloom/`

Everything here is committed. Task state and judgments are never stored here, so no `.gitignore` entry is needed.

| Path | Content |
| --- | --- |
| `decisions/d-<id>.md` | A decision record (`"schemaVersion": 2`): JSON front matter (`choice`, `question`, `scope`, `anchors`, `source`, `replaces`, the task and the judgment), then the question and the person's answer, or the quoted discussion |
| `config.json` | Optional. [Project settings](configuration.md#project-settings) |

- **Sources.** A record from a `fork` answer names the judgment and question; one from a discussion keeps the comment URL, the exact quote and the comment's author, so that text is committed with the record.
- **Replaced and retired records** are removed from the target branch in the PR that replaces or retires them; git history keeps them.
- **Do not edit records by hand.** To change one, a later handoff asks a `fork` question that replaces or retires it. Wording changed during PR review counts as it was merged.

### Records from before 0.4

`decisions/d-<id>.md` files with `"schemaVersion": 1` and everything under `axioms/` are records of the old format. Heirloom no longer writes them and does not use them as rules: recall names them under `legacy`, and the session start does not list their paths. They are not deleted. To carry a decision forward, have the next work on those paths raise it as a `fork` question with a decision proposal and keep it in the repository; afterwards the old file can be removed in an ordinary commit.

## On your computer: `~/.heirloom/`

The environment variable `HEIRLOOM_HOME` changes this location. Directories are created with mode 0700, files with 0600.

| Path | Content |
| --- | --- |
| `config.json` | Optional. [User settings](configuration.md#user-settings) |
| `index.json` | Worktree registry (including the host of each worktree's last session) and the task key → task ID mapping |
| `ids/<hash>/heirloom-repo-id`, `heirloom-worktree-id` | Repository and worktree IDs, only when the repository's `.git` cannot be written (for example in Codex's default sandbox). Normally these IDs live in `.git`. |
| `tasks/<taskId>/input.json` | Input frozen at handoff (source state, materials) |
| `tasks/<taskId>/conversation.json` | The messages the user typed in the session, frozen at handoff for quoting. Messages of later rounds of the task are added; earlier ones stay. |
| `tasks/<taskId>/draft.json` | The agent's draft (schema 2: behavior descriptions, questions, discussions) |
| `tasks/<taskId>/check.json` | Draft check result |
| `tasks/<taskId>/handoff.md` | Readable handoff file, without observed values |
| `tasks/<taskId>/answers.json` | The predictions saved for the current draft |
| `tasks/<taskId>/approvals/ap-<id>.json` | Signed judgments, with the input, draft and probe run each was made on (`.input.json`, `.draft.json`, `.probes.json`). Approvals from before 0.4 may also be here; they are no longer applied. |
| `tasks/<taskId>/events.jsonl` | Task event log |
| `tasks/<taskId>/probes/` | The last probe run: the probes file it ran (`spec.json`), outputs and hashes on base and head (`result.json`, with the allowance it ran under in `permit`), the test command's output (`tests-base.log`, `tests-head.log`) |
| `tasks/<taskId>/probe-permit-request.json` | The probe commands last shown for your allowance, each marked as allowed before or new |
| `tasks/<taskId>/probe-permits/` | Your signed answers to probe permit requests (allowed or denied, with the reason) |
| `sessions/<hash>.json` | Per worktree: the transcript path, first and last hook time of recent sessions (kept for 7 days), and whether the session was told it can hand off work without a spec |
| `keys/current.json` | Fingerprint of the current signing key and where its private key is kept |
| `keys/private.key` | The private key, only when no keychain can be used (mode 0600) |
| `keys/public/<fingerprint>.pub` | Every public key used so far |
| `server/server.json`, `server/server.log` | Dashboard server information and log (including the judgment audit lines) |

## What you may delete

| Target | Safe to delete? |
| --- | --- |
| `server/` | Yes, while the server is stopped. It is recreated. |
| `sessions/` | Yes. A handoff right after has no conversation to quote until the next session start or stop. |
| `tasks/<taskId>/` of finished tasks (PR created, discarded, expired) | Yes. The record files in the repository are not affected. Recall then has fewer probe runs to tell a test anchor's last result. |
| `tasks/<taskId>/` of open tasks | No: the handoff, its predictions and its judgment are lost. |
| `tasks/<taskId>/draft.initial.json` | Yes. Left by versions before 0.4, no longer used. |
| `keys/public/` | No: past judgments can no longer be verified. |
| `ids/` | No: the repository gets new IDs and loses the link to its open tasks. |
| `keys/private.key` or the keychain entry | A new key is created at the next judgment. Verifying past judgments needs only the public keys. |
