# Heirloom

[한국어](README.md)

A plugin for Claude Code, Codex and Antigravity that wraps up work finished with an SDLC tool such as Superpowers. When the agent hands the work off, a human approves the PR summary and the decisions in a local dashboard. The approved records stay in the repository, the PR is opened, and later work picks the decisions up.

## What it does

1. **Handoff.** When spec-based work is done, the agent hands it off. Source quotes in its drafts are checked mechanically.
2. **Approval.** In the dashboard (`http://127.0.0.1:17380/`) you approve the summary and each decision. Approvals are signed.
3. **Records and PR.** The agent writes the records to `.heirloom/` and opens the PR (an MR on GitLab) with the approved summary. If the code changes after approval, only the items the change touches come back to you.
4. **Carry over.** Later sessions start with the active decisions and rules (axioms).

When decisions pile up, the dashboard suggests a **context curation**: cleaning up duplicates and proposing rules worth keeping.

## Install

Requires Node 20 or later and git. Opening PRs also needs `gh` (GitHub) or `glab` (GitLab).

```text
# Claude Code
/plugin marketplace add cheongfish/heirloom#release
/plugin install heirloom@heirloom
```

```sh
# Codex (then trust the Heirloom hooks in /hooks in a Codex session)
codex plugin marketplace add cheongfish/heirloom@release
codex plugin add heirloom@heirloom

# Antigravity CLI
git clone -b release https://github.com/cheongfish/heirloom ~/tools/heirloom
agy plugin install ~/tools/heirloom
```

## Let your agent handle the rest

Installation, settings and troubleshooting can be left to your agent. The detailed documentation is written for agents in [`docs/agent/`](docs/agent/README.md).

> Read https://github.com/cheongfish/heirloom/blob/main/docs/agent/README.md, then install Heirloom on this machine and check it works.

## Good to know

- A handoff is not an approval. Only a human approves, in the dashboard.
- Approvals are signed with a per-user key, and the dashboard listens on `127.0.0.1` only. A program running as the same OS user can still bypass this on purpose; Heirloom aims at detection and audit, not prevention.
- A context curation runs a headless agent only when you choose it, with the commands limited per step.
- Codex and Antigravity support is at a provisional level. Please tell us what you see with the [feedback form](https://github.com/cheongfish/heirloom/issues/new?template=feedback.yml).

## License

Heirloom is licensed under the [Apache License 2.0](LICENSE).

It bundles a pinned copy of [SEED Design](https://github.com/daangn/seed-design) CSS under Apache-2.0. Its `LICENSE` and `NOTICE` are in `skills/using-heirloom/dashboard/vendor/seed-design/`.
