# Hosts

[한국어](../ko/hosts.md)

Heirloom runs in Claude Code, Codex and Antigravity. The handoff, the dashboard, the approval and the records work the same in all three. What differs is how each host loads the plugin, injects the convention at session start and reminds the agent at stop.

## Support level

The levels say which parts of the connection work: **A** the convention is injected (at start and after compaction) and the agent is reminded at stop; **B** only the injection works; **C** only a manual handoff works.

| Host | Level | Checked with | Conditions and limits |
| --- | --- | --- | --- |
| Claude Code | A | Claude Code 2.1 | — |
| Codex | A (provisional) | Codex CLI 0.167.0 | The hooks run only after you trust them in `/hooks`. In Codex's default sandbox the dashboard may not start from the agent's command; open it yourself (below). |
| Antigravity | A (provisional) | Antigravity CLI (`agy`) 1.5.7 | Antigravity has no compaction hook. After compaction the convention stays through an always-on rule (`rules/heirloom.md`) and the compaction summary, not through a new injection. |

"Provisional": the levels come from a short set of headless runs (normal completion, progress report, question, interruption, resume). Error-exit and long runs with another SDLC tool were not repeated enough to give miss or false-call rates. Please report what you see with the [feedback form](https://github.com/cheongfish/heirloom/issues/new?template=feedback.yml).

## Install

Install from the `release` branch, which holds only the plugin files.

### Claude Code

```text
/plugin marketplace add cheongfish/heirloom#release
/plugin install heirloom@heirloom
```

Update: `/plugin marketplace update heirloom`.

### Codex

```sh
codex plugin marketplace add cheongfish/heirloom@release
codex plugin add heirloom@heirloom
```

Then, in a Codex session, open `/hooks` and trust the two Heirloom hooks (SessionStart and Stop). Until then Heirloom works only through a manual handoff. Update: `codex plugin marketplace upgrade heirloom`. If the reminder or the injection stops after an update, check `/hooks` again.

### Antigravity

Clone the `release` branch and install the plugin from that folder:

```sh
git clone -b release https://github.com/cheongfish/heirloom ~/tools/heirloom
agy plugin install ~/tools/heirloom
```

Update: `git -C ~/tools/heirloom pull` and run `agy plugin install ~/tools/heirloom` again. Do not also bring in a Claude Code install with `agy plugin import claude`: the converted hooks would run next to Heirloom's own.

## Using the skills

Agents call the skills on their own. To call one yourself:

| Host | Example |
| --- | --- |
| Claude Code | `/prepare-handoff` |
| Codex | `$prepare-handoff` |
| Antigravity | `/prepare-handoff` |

## Differences

| Topic | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| Hooks file | `hooks/hooks.json` | `hooks/hooks.json` (shared with Claude Code) | `hooks.json` at the plugin root |
| After compaction | The convention is injected again | The convention is injected again | Always-on rule and compaction summary |
| A spec the session read counts as linked (stop reminder) | Read tool calls | Shell commands that name the spec file | `read_file` calls and shell commands |
| Stop after an interruption | No stop hook | No stop hook (checked on an early interruption) | Runs, but Heirloom reminds only after a normal end of the turn |
| Repository IDs | In `.git` | In `~/.heirloom/ids/` when the sandbox keeps `.git` read-only | In `.git` |
| Headless context curation | `claude -p` with allowed tools | `codex exec` with a per-run allow-list hook ([Security](security.md#headless-curation-runs)) | `agy -p` with per-run permission rules |

### Opening the dashboard from Codex

Codex's default sandbox blocks network access, so the agent's handoff cannot start or reach the dashboard. The handoff is still saved and the agent reports the dashboard error. Open the dashboard from a terminal outside Codex:

```sh
node ~/.codex/plugins/cache/heirloom/heirloom/<version>/skills/using-heirloom/scripts/open-dashboard.mjs
```

### Codex trust entries

`codex exec` records each directory it runs in as trusted in `~/.codex/config.toml` (`[projects."<path>"] trust_level = "trusted"`), also for headless curation runs. Each curation therefore leaves one entry for its worktree under `~/.heirloom/worktrees/`. Heirloom does not edit your Codex config; remove old entries yourself if you want.
