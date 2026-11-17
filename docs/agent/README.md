# Heirloom: documentation for agents

This folder is for an agent that installs, configures or troubleshoots Heirloom for a user. It is reference material, written so that each page answers one task with exact commands, expected results and what to do when something fails. Answer the user in their language.

It is not the convention a development session follows. Inside a session, Heirloom injects its convention at session start and the skills (`skills/*/SKILL.md` in the installed plugin) say what to run; follow those, not this folder.

## What Heirloom is

A plugin for Claude Code, Codex and Antigravity, with partial support for Cursor CLI. After an SDLC tool (for example Superpowers) finishes spec-based work, or when the user asks to hand off other work (for example work asked for in the chat), the agent hands it off. Heirloom freezes the state and runs the agent's probes (commands that show what the change does) on base and head itself; the agent drafts questions from the recorded output, and Heirloom checks them against that output and their sources. In a local dashboard a human first predicts the results, then sees them and judges each question. If everything is accepted, the agent opens the PR with a paragraph built from the signed judgment, Heirloom posts a `heirloom/understood` commit status on the judged commit, and the few choices later work must keep become decision records in `.heirloom/decisions/`. Otherwise the work goes back to the agent with the reasons. Later sessions recall the decision records, with their anchors checked.

## Rules for agents using this folder

- **Never predict or judge for the user.** Predictions and judgments happen only in the dashboard, by the human. Do not call the dashboard's API, do not read or copy `~/.heirloom/keys/`, do not create or edit files under `~/.heirloom/tasks/`.
- **Do not edit records by hand.** `.heirloom/decisions/` changes only through an accepted judgment. Files of the old format (schema 1 decisions, `.heirloom/axioms/`) are past records; removing one is an ordinary commit the user decides on.
- **Let the user grant trust.** Installing the plugin, trusting hooks (Codex `/hooks`) and changing permission settings are the user's decisions. Ask before running such commands, and leave trust prompts to the user.
- **No `--dangerously-*` flags** unless the user asks for them.
- **Do not edit the host's own config** (for example `~/.codex/config.toml`) unless the user asks.
- **Check the installed version first.** These pages describe the `main` branch. Read `version` in the installed plugin's `.claude-plugin/plugin.json` ([Install locations](install.md#install-locations)); if it is older than the newest entry in [`CHANGELOG.md`](../../CHANGELOG.md), behavior may differ, so say so.

## Pages

| Task | Page |
| --- | --- |
| Install, check, update or remove Heirloom in a host | [install.md](install.md) |
| Support level and differences per host (hooks, compaction, skills syntax) | [hosts.md](hosts.md) |
| Something does not work: symptom → check → cause → fix | [troubleshooting.md](troubleshooting.md) |
| How handoff, probes, judgment, PR, records, recheck and recall work | [workflow.md](workflow.md) |
| The dashboard screens and server | [dashboard.md](dashboard.md) |
| Settings files, keys, defaults, environment variables | [configuration.md](configuration.md) |
| Where data lives and what may be deleted | [data.md](data.md) |
| Security model, known limits | [security.md](security.md) |

## Requirements

| Item | Requirement |
| --- | --- |
| Node.js | 20 or later (`node --version`). Built-in modules only; no `npm install`. Without Node, the session start shows one line, "Heirloom 비활성: Node 20 이상이 필요합니다.", and Heirloom stays off. |
| git | The project must be a git repository. The target branch comes from `origin/HEAD` or the project setting `baseBranch`. |
| Host | Claude Code, Codex CLI or Antigravity CLI; Cursor CLI in part ([hosts.md](hosts.md)). |
| `gh` (optional) | To open PRs, post the commit status and fetch discussion comments on github.com, logged in (`gh auth status`). GitHub Enterprise is not supported. |
| `glab` (optional) | To open merge requests, post the commit status and fetch discussion notes on gitlab.com or a self-hosted GitLab logged in with `glab auth login --hostname <host>`. Commands follow glab 1.36. |
| OS | Linux, macOS, WSL. |

## Not supported

| Feature | Current behavior |
| --- | --- |
| Windows keychain | The private key is kept in a file (mode 0600). |
| GitHub Enterprise | Only github.com counts as GitHub. |
| Reminder at stop in Cursor CLI | Cursor CLI runs no stop hook. The agent hands off from the convention alone; nothing reminds it. |
| Cursor IDE, other Cursor install methods | Not checked. Use the Cursor CLI with `--plugin-dir`. |

## Feedback

Problems or friction: [feedback form](https://github.com/cheongfish/heirloom/issues/new?template=feedback.yml). Leave out code, spec text, tokens and internal paths.
