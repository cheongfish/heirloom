# Heirloom

[한국어](README.md)

Heirloom is a Claude Code plugin that wraps up work finished with an SDLC tool such as Superpowers. It prepares a handoff and lets a human approve the PR summary and the decisions in a local dashboard. It then writes the approved records into the repository and opens the pull request. Later work receives the active decisions and axioms.

Heirloom does not do the development work, and a handoff is not an approval. Only a human approves, in the dashboard.

> Status: 0.1 (MVP). Some features are still in progress; see the [Roadmap](docs/guide/en/roadmap.md).

## Installation

Requires Node 20 or later, git and Claude Code. Opening the PR needs `gh` for a github.com remote, or `glab` for a GitLab remote (gitlab.com or self-hosted). There are no runtime dependencies to install.

Install from the `release` branch, which holds only the plugin files:

```text
/plugin marketplace add <owner>/heirloom#release
/plugin install heirloom@heirloom
```

To try a checkout for one session without installing: `claude --plugin-dir /path/to/heirloom`.

→ [Installation guide](docs/guide/en/installation.md)

## Workflow

1. **Handoff.** The agent hands off finished spec-based work. Source quotes in its drafts are checked mechanically.
2. **Approval.** You review the summary and each decision and axiom in the dashboard. Approvals are signed.
3. **Records and PR.** The agent verifies the approval, writes `.heirloom/` records and opens the PR (a merge request on GitLab) with the approved summary verbatim. A session still waiting for the approval does this as soon as you approve.
   - If the code changes after approval, even after the PR is open, only the items the change touches come back to you. The rest keep their approval.
4. **Recall.** Later sessions start with the active axioms and a decision index, and the agent fetches the full text of related records. A record becomes active once it is merged into the target branch.

→ [Workflow guide](docs/guide/en/workflow.md)

## Context curation

When decisions pile up, the dashboard suggests a curation. If you run it, a headless agent reviews a batch of decisions in a dedicated worktree and proposes duplicate clean-up, relations and axiom candidates. You approve each proposal, giving a reason for any candidate you hold or reject, and the result arrives as a PR (a merge request on GitLab).

→ [Context curation](docs/guide/en/curation.md)

## Dashboard

A local page at `http://127.0.0.1:17380/` with an overview and a tabbed screen per task. It opens once per handoff. Ask the agent to reopen it any time. The server stops by itself when idle.

→ [Dashboard guide](docs/guide/en/dashboard.md)

## Data locations

- `<repository>/.heirloom/`: decision and axiom records, and curation review history. Committed.
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
- Windows keychain.

→ [Roadmap](docs/guide/en/roadmap.md)

## License

Heirloom is licensed under the [Apache License 2.0](LICENSE).

It bundles a pinned copy of [SEED Design](https://github.com/daangn/seed-design) CSS under Apache-2.0. Its `LICENSE` and `NOTICE` are in `skills/using-heirloom/dashboard/vendor/seed-design/`.
