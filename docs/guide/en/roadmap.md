# Roadmap

[한국어](../ko/roadmap.md)

The following features are not supported yet and are planned for later versions. Scope and timing may change.

| Feature | Current behavior |
| --- | --- |
| Codex and Antigravity hosts | Only Claude Code is supported. |
| GitLab (`glab`) and remotes other than github.com | Record files are written; you open the PR yourself. A [context curation](curation.md) commits its records in its worktree; you push and merge the branch yourself. |
| Headless curation with Codex or Antigravity | Curation runs Claude Code only (`curation.agent.host`). |
| Windows keychain | The private key is kept in a file (mode 0600). |
