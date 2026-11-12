# Installation

[한국어](../ko/installation.md)

## Requirements

| Item | Requirement |
| --- | --- |
| Node.js | 20 or later. Heirloom uses only Node built-in modules, so no `npm install` is needed. |
| git | The project you work on must be a git repository. The target branch comes from `origin/HEAD` or the project setting `baseBranch`. |
| Claude Code | The only supported host for now. |
| `gh` (optional) | Needed only to open pull requests. The remote must be on github.com and `gh auth login` must be done. Without it, Heirloom writes the record files and you open the PR yourself. |
| Operating system | Linux, macOS, WSL. The Windows keychain is not used yet (the key is kept in a file). |

If Node is missing or older than 20, Heirloom does not block the session. The session start shows one line, "Heirloom 비활성: Node 20 이상이 필요합니다." (Heirloom inactive: Node 20 or later is required), and everything else stays off.

## Install

### As a marketplace plugin

The repository is also a plugin marketplace (`.claude-plugin/marketplace.json`). Install from the `release` branch. It holds only the plugin files (`.claude-plugin/`, `hooks/`, `skills/`, `examples/`); tests and development files stay on `main`. Add it once and install the plugin. It then loads in every session.

```text
/plugin marketplace add <owner>/heirloom#release
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

- [Workflow](workflow.md)
- [Configuration](configuration.md)
