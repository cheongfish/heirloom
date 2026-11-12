# Configuration

[한국어](../ko/configuration.md)

All settings files are optional; without them the defaults apply. Copy an example file, which lists every setting at its default, and change only what you need.

| Settings | Location | Example |
| --- | --- | --- |
| User settings | `~/.heirloom/config.json` | [`examples/user-config.example.json`](../../../examples/user-config.example.json) |
| Project settings | `<repository>/.heirloom/config.json` (committed) | [`examples/project-config.example.json`](../../../examples/project-config.example.json) |

```sh
cp examples/user-config.example.json ~/.heirloom/config.json
cp examples/project-config.example.json <repository>/.heirloom/config.json
```

The files are JSON, so they cannot hold comments. Unknown keys and out-of-range values are reported as errors. Both files need `"schemaVersion": 1`.

## User settings

| Key | Default | Description |
| --- | --- | --- |
| `dashboard.port` | `17380` | Dashboard port (1024–65535). A change applies the next time the server starts; a running server moves to the new port after it stops for idleness or restarts. |
| `dashboard.idleMinutes` | `30` | Minutes without an open screen or a request before the server stops |
| `dashboard.openBrowser` | `true` | Whether to open the browser automatically after a handoff. Explicit requests to open the dashboard are not affected. |
| `dashboard.staleDays` | `7` | Days after which an unfinished task is listed as stale in the overview |
| `curation.agent.host` | `"claude-code"` | Headless agent profile used by [context curation](curation.md). Only `claude-code` exists so far. |
| `curation.agent.command` | `"claude"` | Command the dashboard runs for a curation. A name on `PATH` or an absolute path. Requests to the dashboard can never change it. |
| `curation.agent.model` | `null` | Model passed to the headless agent (`--model`). `null` uses the command's default. |

## Project settings

| Key | Default | Description |
| --- | --- | --- |
| `baseBranch` | none | Target branch of the PR. Without it, `origin/HEAD` is used. If neither exists, or several remotes make it unclear, Heirloom reports an error instead of guessing. |
| `specGlobs` | `["docs/superpowers/specs/**", "**/specs/**/*.md"]` | Paths that count as spec documents. Used by the stop hook's handoff reminder. When a handed-off spec does not match, the agent offers to add a pattern and, if you agree, creates this file or adds to it. |
| `recall.maxRecords` | `8` | Maximum number of records returned by context recall |
| `recall.maxTokens` | `6000` | Token budget for context recall, estimated as UTF-8 bytes ÷ 3 (about one token per Hangul syllable) |
| `sessionIndex.maxDecisions` | `30` | Number of decisions listed in the session-start index |
| `curation.minUnreviewed` | `10` | Suggest a [context curation](curation.md) when this many decisions are unreviewed |
| `curation.maxAgeDays` | `30` | … or when this many days passed since the last curation |
| `curation.minForAge` | `3` | … and at least this many decisions are unreviewed |
| `curation.batchSize` | `20` | Maximum number of unreviewed decisions one curation reviews |

## Environment variables

| Variable | Description |
| --- | --- |
| `HEIRLOOM_HOME` | Location of the local store. Default `~/.heirloom` |
| `HEIRLOOM_PORT` | Dashboard port. Takes precedence over `dashboard.port`. Mainly for development and tests. |
| `HEIRLOOM_KEYSTORE=file` | Keep the private key in a file instead of the keychain. Mainly for development and tests. |
