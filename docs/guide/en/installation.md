# Installation

[한국어](../ko/installation.md)

## Requirements

| Item | Requirement |
| --- | --- |
| Node.js | 20 or later. Heirloom uses only Node built-in modules, so no `npm install` is needed. |
| git | The project you work on must be a git repository. The target branch comes from `origin/HEAD` or the project setting `baseBranch`. |
| Host | Claude Code, Codex or Antigravity CLI. Install steps and support levels per host: [Hosts](hosts.md). |
| `gh` (optional) | Needed only to open pull requests on github.com. `gh auth login` must be done. GitHub Enterprise hosts are not supported. |
| `glab` (optional) | Needed only to open merge requests on GitLab: gitlab.com, or a self-hosted GitLab that `glab auth login --hostname <host>` was done for (any other host counts as unsupported). The commands Heirloom uses follow glab 1.36. |
| Operating system | Linux, macOS, WSL. The Windows keychain is not used yet (the key is kept in a file). |

If Node is missing or older than 20, Heirloom does not block the session. The session start shows one line, "Heirloom 비활성: Node 20 이상이 필요합니다." (Heirloom inactive: Node 20 or later is required), and everything else stays off.

## Install

### As a marketplace plugin

The repository is also a plugin marketplace (`.claude-plugin/marketplace.json`). Install from the `release` branch. It holds only the plugin files (the host manifests, `hooks/`, `hooks.json`, `rules/`, `skills/`, `examples/`); tests and development files stay on `main`. Add it once and install the plugin. It then loads in every session. The steps below are for Claude Code; Codex and Antigravity are in [Hosts](hosts.md#install).

```text
/plugin marketplace add cheongfish/heirloom#release
/plugin install heirloom@heirloom
```

Run `/plugin marketplace update heirloom` to pick up a new release.

### For one session

Clone the repository and start Claude Code with it as a plugin directory. Nothing is installed.

```sh
git clone <heirloom repository URL> ~/tools/heirloom
```

```sh
cd <your project>
claude --plugin-dir ~/tools/heirloom
```

## Check the installation

1. Start a session with the command above.
2. Ask the agent something like "Do you see the Heirloom convention?". The `<heirloom-convention>` and `<heirloom-project>` blocks are injected at session start.
3. To check the dashboard, ask the agent "Open the Heirloom dashboard". The browser opens `http://127.0.0.1:17380/`.

## Next

- [Hosts](hosts.md)
- [Workflow](workflow.md)
- [Configuration](configuration.md)
