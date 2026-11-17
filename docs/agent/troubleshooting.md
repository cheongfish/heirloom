# Troubleshooting

Each Heirloom script prints one JSON object: `{"ok":true,"data":…}` or `{"ok":false,"error":{"code","message","hint"}}`. Exit codes: `0` success, `2` input error, `3` state conflict, `4` verification failure, `75` transient error (retried once). Read `error.hint` first.

## Collect diagnostics

| What | How |
| --- | --- |
| Hook input and output | Start the host with `HEIRLOOM_HOOK_LOG=1`; read `~/.heirloom/hook-log.jsonl` |
| Dashboard server | `~/.heirloom/server/server.log` |
| A task's history | `~/.heirloom/tasks/<taskId>/events.jsonl` (one event per line) |
| Installed version | `version` in `<plugin folder>/.claude-plugin/plugin.json` ([install.md](install.md#install-locations)) |

## Symptoms

| Symptom | Check | Cause → fix |
| --- | --- | --- |
| No convention at session start | Hook log has no `session-start` line | Plugin not installed or not enabled → [install.md](install.md). Codex: hooks not trusted → the user trusts them in `/hooks`. Antigravity: `agy plugin list --json` does not list a hook → reinstall. |
| Session start says "Heirloom 비활성: Node 20 이상이 필요합니다." | `node --version` | Node missing or older than 20 → install Node 20+, start a new session. |
| No reminder when the agent stops | Hook log `stop` line has empty output | Reminds only once per source state, and only when there are non-Markdown changes, a linked spec, and no handoff for that state ([workflow.md](workflow.md#1-handoff-and-probes)). Without a linked spec the agent is told only once per session, and only when the host gives a transcript. A spec outside `specGlobs` is not linked → add a pattern ([configuration.md](configuration.md#project-settings)). Antigravity reminds only after a normal end of the turn, not after cancel, error or `/compact`. Cursor CLI never reminds: it runs no stop hook. |
| Handoff fails: target branch unknown | `git symbolic-ref refs/remotes/origin/HEAD` | No `origin/HEAD` → `git remote set-head origin -a`, or set `baseBranch` in `.heirloom/config.json`. Heirloom never guesses the branch. |
| Handoff fails with `EROFS` on `.git/heirloom-repo-id` | Installed version | Old version in a sandbox that keeps `.git` read-only (Codex) → update; newer versions keep the IDs in `~/.heirloom/ids/`. |
| Draft refused (exit 4) | `error.message` lists JSON paths | Fix the draft and submit again (the skill stops after two rounds). Common causes: a number or quoted value in a behavior description is not in the cited probe output; `probeSetHash` is not the last probe run (run `probe.mjs` again after `prepare`); a quote is not in its source (a `@conversation` quote must be the user's own words from one message); a decision anchor's file, name or test is missing, or the test did not pass on head; `$.schemaVersion: 2여야 함` (a draft of the old format). |
| Draft refused: `spec …: 판정 …에서 … 인용한 줄이 그대로임` | The previous judgment's spec choice | The person said those spec lines are wrong or deferred → change text inside the cited lines (a marker on a new line next to them does not count), then hand off again. |
| Draft refused: discussion `토론을 가져오지 못함` or `이 저장소의 토론이 아님` | `gh auth status` / `glab auth status --hostname <host>`; the URL | The CLI is missing, not logged in or offline, or the URL points at another repository or is not a comment URL → log in, or fix the URL. |
| Probe run fails or every output is the same on base and head | `~/.heirloom/tasks/<taskId>/probes/result.json` (`warnings`, `setup`) | Dependencies missing in the temporary worktrees → set `probe.setup` (for example `[["npm", "ci"]]`). Identical outputs mean the probes do not pass through the changed code → change the probe inputs. |
| Handoff has no conversation (`conversation.available: false`) | `conversation.reason` in the `prepare.mjs` result | `no_session`: no session start or stop hook has run with a transcript in this worktree → start a new session. `ambiguous`: two sessions of the worktree ran at the same time → end the other one and hand off again. `unreadable`/`empty`: the host's transcript format may have changed → report it. The handoff itself is not affected. |
| Dashboard does not open | `lsof -i :17380` | Port used by another program → stop it or set `dashboard.port`. Codex sandbox blocks network → run `open-dashboard.mjs` outside Codex ([hosts.md](hosts.md)). WSL without `wslview` → open the printed URL by hand. |
| Judged, but nothing was applied | Task state in the dashboard | The session ended → in a new session ask the agent to "apply the approved handoff". State `stale` / "재확인 필요" → code changed after the judgment; run `prepare-handoff` again for a recheck ([workflow.md](workflow.md#changes-after-the-judgment)). State `returned` / "되돌림" → you sent it back; the agent fixes it and hands off again. |
| `apply.mjs` result `spec.pending: true` | `spec.specs[].status` | `uncommitted`: the spec has uncommitted changes → commit, run `apply.mjs` again. `archive_taken`: a file already exists at `docs/specs/archive/<name>` → the user decides which to keep. |
| No `heirloom/understood` status on the PR | `complete.mjs` result `status` | `posted: false` with an error → permissions or network; run `complete.mjs` again. No status on the latest commit is expected when it was pushed after the judgment → recheck. |
| Recall marks a record `possibly-stale` | `anchors` in the `recall.mjs` result | An anchor file or name was renamed or removed, or the locking test failed on the last probe run → ask the user whether the decision still holds; if not, retire it with a `fork` question in the next handoff. |
| No PR or MR | `apply.mjs` result `pr.available: false` and its reason | `gh`/`glab` missing or not logged in, or the remote is not github.com/GitLab → records are committed; the user opens the PR or merges. |
| Judgment rejected as unsigned or tampered | `error.code` from `apply.mjs` | The draft or judgment changed after signing → judge again in the dashboard. Never re-sign by hand. |
| `apply.mjs` exits 4 with `지원하지 않는 이전 형식(항목별 승인)` | Installed version and the task's age | The task was approved item by item before 0.4 → run `prepare-handoff` again; the work is judged anew. |

## Reporting

If none of this helps, ask the user to open a [feedback issue](https://github.com/cheongfish/heirloom/issues/new?template=feedback.yml) with the host and its version, the Heirloom version, the step, and the relevant lines of the logs above with code, spec text, tokens and internal paths removed.
