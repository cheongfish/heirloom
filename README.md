# Heirloom

[한국어](README.ko.md)

Heirloom is a Claude Code plugin that wraps up work finished with an SDLC tool such as Superpowers. It prepares a handoff and lets a human approve the PR summary and the decisions in a local dashboard. It then writes the approved records into the repository and opens the pull request. Later work receives the active decisions and axioms.

Heirloom does not do the development work, and a handoff is not an approval. Only a human approves, in the dashboard.

> Status: 0.1 (MVP). Some features are still in progress; see the [Roadmap](docs/guide/en/roadmap.md).

## Installation

Requires Node 20 or later, git and Claude Code. `gh` with a github.com remote is needed only to open PRs. There are no runtime dependencies to install.

```sh
claude --plugin-dir /path/to/heirloom
```

→ [Installation guide](docs/guide/en/installation.md)

## Workflow

1. **Handoff.** The agent hands off finished spec-based work. Source quotes in its drafts are checked mechanically.
2. **Approval.** You review the summary and each decision and axiom in the dashboard. Approvals are signed.
3. **Records and PR.** The agent verifies the approval, writes `.heirloom/` records and opens the PR with the approved summary verbatim.
4. **Recall.** Later sessions start with the active axioms and a decision index, and the agent fetches the full text of related records. A record becomes active once it is merged into the target branch.

→ [Workflow guide](docs/guide/en/workflow.md)

## Dashboard

A local page at `http://127.0.0.1:17380/` with an overview and a tabbed screen per task. It opens once per handoff. Ask the agent to reopen it any time. The server stops by itself when idle.

→ [Dashboard guide](docs/guide/en/dashboard.md)

## Data locations

- `<repository>/.heirloom/`: decision and axiom records. Committed.
- `~/.heirloom/` (or `HEIRLOOM_HOME`): tasks, approvals, keys and server state. Local only.

→ [Data locations](docs/guide/en/data.md)

## Configuration

Settings are optional. Copy an example from [`examples/`](examples/) and change what you need: port, idle time, automatic browser opening, target branch, spec paths and more.

→ [Configuration guide](docs/guide/en/configuration.md)

## Security

Approvals are signed with a per-user ed25519 key. The dashboard listens on `127.0.0.1` only and checks the Host, the Origin and a session token. An agent running as the same OS user can still bypass this on purpose. Heirloom aims at detection and audit, not prevention.

→ [Security model and limits](docs/guide/en/security.md)

## Roadmap

Planned:

- Codex and Antigravity hosts,
- GitLab,
- incremental re-check after approval,
- axiom candidates,
- Windows keychain.

→ [Roadmap](docs/guide/en/roadmap.md)

## License

Heirloom is licensed under the [Apache License 2.0](LICENSE).

It bundles a pinned copy of [SEED Design](https://github.com/daangn/seed-design) CSS under Apache-2.0. Its `LICENSE` and `NOTICE` are in `skills/using-heirloom/dashboard/vendor/seed-design/`.
