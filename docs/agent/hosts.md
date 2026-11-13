# Hosts

Heirloom runs in Claude Code, Codex, Antigravity and, in part, Cursor CLI. The handoff, the dashboard, the approval and the records work the same in all of them. What differs is how each host loads the plugin, injects the convention at session start and reminds the agent at stop.

## Support level

The levels say which parts of the connection work: **A** the convention is injected (at start and after compaction) and the agent is reminded at stop; **B** only the injection works; **C** only a manual handoff works.

| Host | Level | Checked with | Conditions and limits |
| --- | --- | --- | --- | --- |
| Claude Code | A | Claude Code 2.1 | — |
| Codex | A (provisional) | Codex CLI 0.167.0 | The hooks run only after you trust them in `/hooks`. In Codex's default sandbox the dashboard may not start from the agent's command; open it yourself (below). |
| Cursor CLI | B (provisional) | Cursor CLI (`agent`) 2026.11.11 | Cursor CLI runs no stop hook, so there is no reminder at stop: spec-based work the agent forgets to hand off is not caught, and work without a spec gets no notice. The convention comes from the session-start context and an always-applied rule (`.cursor-plugin/rules/heirloom.mdc`); a resumed session (`--resume`) gets only the rule. A context curation never runs with Cursor. The Cursor IDE was not checked. |
| Antigravity | A (provisional) | Antigravity CLI (`agy`) 1.5.7 | Antigravity has no compaction hook. After compaction the convention stays through an always-on rule (`rules/heirloom.md`) and the compaction summary, not through a new injection. |

"Provisional": the levels come from a short set of headless runs (normal completion, progress report, question, interruption, resume). Error-exit and long runs with another SDLC tool were not repeated enough to give miss or false-call rates. Please report what you see with the [feedback form](https://github.com/cheongfish/heirloom/issues/new?template=feedback.yml).

Install, update and removal per host: [Install](install.md).

## Using the skills

Agents call the skills on their own. To call one yourself:

| Host | Example |
| --- | --- |
| Claude Code | `/prepare-handoff` |
| Codex | `$prepare-handoff` |
| Antigravity | `/prepare-handoff` |
| Cursor CLI | Ask in plain words, for example "hand this off with Heirloom" |

## Differences

| Topic | Claude Code | Codex | Antigravity | Cursor CLI |
| --- | --- | --- | --- |
| Hooks file | `hooks/hooks.json` | `hooks/hooks.json` (shared with Claude Code) | `hooks.json` at the plugin root | `hooks/hooks-cursor.json`, named by `.cursor-plugin/plugin.json`; only `sessionStart` |
| After compaction | The convention is injected again | The convention is injected again | Always-on rule and compaction summary | Always-applied rule |
| A spec the session read counts as linked (stop reminder) | Read tool calls | Shell commands that name the spec file | `read_file` calls and shell commands | — (no stop reminder) |
| Messages the user typed (conversation source of a handoff) | `user` lines from a person (`origin.kind` `human`, or no origin); not tool results, meta lines, slash command echoes or `!` shell lines | `UserMessage` items of `item_completed` events; not the environment context or hook prompts | Text inside `<USER_REQUEST>` of `USER_INPUT` steps from `USER_EXPLICIT`; not slash commands | Text inside `<user_query>` of `user` lines. The session is the one the agent's shell names (`CURSOR_CONVERSATION_ID`, `AGENT_TRANSCRIPTS`), so sessions running side by side do not mix |
| Folder the hooks work in | `cwd` | `cwd` | `cwd`, or the first git repository among `workspacePaths` when `cwd` is not one (a folder added with `--add-dir` can come first) | The first of `workspace_roots` (hooks run in the plugin folder and get no `cwd`) |
| Stop after an interruption | No stop hook | No stop hook (checked on an early interruption) | Runs, but Heirloom reminds only after a normal end of the turn | No stop hook |
| Repository IDs | In `.git` | In `~/.heirloom/ids/` when the sandbox keeps `.git` read-only | In `.git` | In `.git` |
| Headless context curation | `claude -p` with allowed tools | `codex exec` with a per-run allow-list hook ([Security](security.md#headless-curation-runs)) | `agy -p` with per-run permission rules | Not available; the curation runs with another host |

### Opening the dashboard from Codex

Codex's default sandbox blocks network access, so the agent's handoff cannot start or reach the dashboard. The handoff is still saved and the agent reports the dashboard error. Open the dashboard from a terminal outside Codex:

```sh
node ~/.codex/plugins/cache/heirloom/heirloom/<version>/skills/using-heirloom/scripts/open-dashboard.mjs
```

### Codex trust entries

`codex exec` records each directory it runs in as trusted in `~/.codex/config.toml` (`[projects."<path>"] trust_level = "trusted"`), also for headless curation runs. Each curation therefore leaves one entry for its worktree under `~/.heirloom/worktrees/`. Heirloom does not edit your Codex config; remove old entries yourself if you want.
