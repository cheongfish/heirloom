# Troubleshooting

Each Heirloom script prints one JSON object: `{"ok":true,"data":…}` or `{"ok":false,"error":{"code","message","hint"}}`. Exit codes: `0` success, `2` input error, `3` state conflict, `4` verification failure, `75` transient error (retried once). Read `error.hint` first.

## Collect diagnostics

| What | How |
| --- | --- |
| Hook input and output | Start the host with `HEIRLOOM_HOOK_LOG=1`; read `~/.heirloom/hook-log.jsonl` |
| Dashboard server | `~/.heirloom/server/server.log` |
| A task's history | `~/.heirloom/tasks/<taskId>/events.jsonl` (one event per line) |
| A headless curation run | `~/.heirloom/tasks/<taskId>/agent-<curate or apply>.log` |
| Installed version | `version` in `<plugin folder>/.claude-plugin/plugin.json` ([install.md](install.md#install-locations)) |

## Symptoms

| Symptom | Check | Cause → fix |
| --- | --- | --- |
| No convention at session start | Hook log has no `session-start` line | Plugin not installed or not enabled → [install.md](install.md). Codex: hooks not trusted → the user trusts them in `/hooks`. Antigravity: `agy plugin list --json` does not list a hook → reinstall. |
| Session start says "Heirloom 비활성: Node 20 이상이 필요합니다." | `node --version` | Node missing or older than 20 → install Node 20+, start a new session. |
| No reminder when the agent stops | Hook log `stop` line has empty output | Reminds only once per source state, and only when there are non-Markdown changes, a linked spec, and no handoff for that state ([workflow.md](workflow.md#1-handoff)). Without a linked spec the agent is told only once per session, and only when the host gives a transcript. A spec outside `specGlobs` is not linked → add a pattern ([configuration.md](configuration.md#project-settings)). Antigravity reminds only after a normal end of the turn, not after cancel, error or `/compact`. |
| Handoff fails: target branch unknown | `git symbolic-ref refs/remotes/origin/HEAD` | No `origin/HEAD` → `git remote set-head origin -a`, or set `baseBranch` in `.heirloom/config.json`. Heirloom never guesses the branch. |
| Handoff fails with `EROFS` on `.git/heirloom-repo-id` | Installed version | Old version in a sandbox that keeps `.git` read-only (Codex) → update; newer versions keep the IDs in `~/.heirloom/ids/`. |
| Draft refused (exit 4) | `error.message` lists JSON paths | A quote is not in its source, or a code path is a Markdown file → fix the draft and submit again (the skill stops after two rounds). A `@conversation` quote must be the user's own words from one message, not the agent's reply. |
| Handoff has no conversation (`conversation.available: false`) | `conversation.reason` in the `prepare.mjs` result | `no_session`: no session start or stop hook has run with a transcript in this worktree → start a new session. `ambiguous`: two sessions of the worktree ran at the same time → end the other one and hand off again. `unreadable`/`empty`: the host's transcript format may have changed → report it. The handoff itself is not affected. |
| Dashboard does not open | `lsof -i :17380` | Port used by another program → stop it or set `dashboard.port`. Codex sandbox blocks network → run `open-dashboard.mjs` outside Codex ([hosts.md](hosts.md)). WSL without `wslview` → open the printed URL by hand. |
| Approved, but nothing was applied | Task state in the dashboard | The session ended → in a new session ask the agent to "apply the approved handoff". State `stale` / "재확인 필요" → code changed after approval; run `prepare-handoff` again for a re-check ([workflow.md](workflow.md#changes-after-approval)). |
| No PR or MR | `apply.mjs` result `pr.available: false` and its reason | `gh`/`glab` missing or not logged in, or the remote is not github.com/GitLab → records are committed; the user opens the PR or merges. |
| Approval rejected as unsigned or tampered | `error.code` from `apply.mjs` | The draft or approval changed after signing → approve again in the dashboard. Never re-sign by hand. |
| Headless curation failed: `command_missing` | Dashboard task screen | The host CLI is not on `PATH` → install it or set `curation.agent.command`. The host is the repository's last session host ([curation.md](curation.md)). |
| Headless curation failed: `permission_denied` | `agent-<step>.log` | Antigravity needed a command outside the run's allow list → run again, or run the step by hand in the curation worktree. |
| Headless curation failed: time limit | `agent-<step>.log` | Stopped after 30 minutes → run again or by hand. |
| `~/.codex/config.toml` gains `[projects."…/.heirloom/worktrees/…"]` entries | — | `codex exec` records each curation worktree as trusted. Heirloom does not edit Codex's config; the user may remove old entries. |

## Reporting

If none of this helps, ask the user to open a [feedback issue](https://github.com/cheongfish/heirloom/issues/new?template=feedback.yml) with the host and its version, the Heirloom version, the step, and the relevant lines of the logs above with code, spec text, tokens and internal paths removed.
