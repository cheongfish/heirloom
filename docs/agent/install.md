# Install

Install from the `release` branch: it holds only the plugin files (host manifests, `hooks/`, `hooks.json`, `rules/`, `skills/`, `examples/`). Ask the user before installing; trust prompts are theirs to answer.

## Claude Code

```text
/plugin marketplace add cheongfish/heirloom#release
/plugin install heirloom@heirloom
```

- Update: `/plugin marketplace update heirloom`.
- Remove: `/plugin uninstall heirloom@heirloom`, then `/plugin marketplace remove heirloom`.
- One session without installing (a clone of the repository): `claude --plugin-dir <clone>`.

## Codex

```sh
codex plugin marketplace add cheongfish/heirloom@release
codex plugin add heirloom@heirloom
```

- Then the user opens `/hooks` in a Codex session and trusts the two Heirloom hooks (SessionStart and Stop). Until then only a manual handoff works.
- Update: `codex plugin marketplace upgrade heirloom`. If the injection or the reminder stops after an update, have the user check `/hooks` again.
- Remove: `codex plugin remove heirloom@heirloom`, then `codex plugin marketplace remove heirloom`.

## Antigravity

```sh
git clone -b release https://github.com/cheongfish/heirloom ~/tools/heirloom
agy plugin install ~/tools/heirloom
```

- Check: `agy plugin list --json` lists `heirloom` with 5 skills, 1 rule and 1 hook.
- Update: `git -C ~/tools/heirloom pull`, then `agy plugin install ~/tools/heirloom` again.
- Remove: `agy plugin uninstall heirloom`.
- Do not also run `agy plugin import claude` for Heirloom: its converted hooks would run next to Heirloom's own.

## Install locations

| Host | Plugin folder |
| --- | --- |
| Claude Code | `~/.claude/plugins/cache/heirloom/heirloom/<version>/` |
| Codex | `~/.codex/plugins/cache/heirloom/heirloom/<version>/` |
| Antigravity | `~/.gemini/config/plugins/heirloom/` |

The installed version is `version` in `<plugin folder>/.claude-plugin/plugin.json`.

## Check the installation

1. `node --version` prints 20 or later.
2. The user starts a new session in a git repository and asks "Do you see the Heirloom convention?". The answer should quote the `<heirloom-convention>` block (it says to run `prepare-handoff` before reporting a spec-based task as finished).
3. To see what the hooks received and printed, start the host with `HEIRLOOM_HOOK_LOG=1` set; each hook appends a line to `~/.heirloom/hook-log.jsonl`.
4. Dashboard: ask the agent in a session to "open the Heirloom dashboard", or run `node <plugin folder>/skills/using-heirloom/scripts/open-dashboard.mjs`. It prints one JSON object with the URL (default `http://127.0.0.1:17380/`).

## Remove local data

Removing the plugin keeps `~/.heirloom/` (approvals, keys, task state) and the repository's `.heirloom/` records. Delete `~/.heirloom/` only if the user wants to; see [data.md](data.md#what-you-may-delete) first.
