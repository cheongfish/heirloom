---
name: recall-context
description: "Use before changing covered files or relying on a decision or axiom; retrieves applicable records."
---

# Recall Context

Read full records before relying on them or editing covered code; the session-start index alone is insufficient.

## Run

Run when intended files are known, an index entry is `[관련]`, or a user/spec cites a record id. Repeat for expanded scope, not identical queries.

```sh
node <this skill>/scripts/recall.mjs [--paths <path,...>] [--topics <topic,...>] [--ids <id,...>] [--limit <n>]
```

- `--paths`: intended repository-relative code files/directories, even before edits. Exclude Markdown documents.
- `--topics`: matching record topic words; `--ids`: decision/axiom ids (`d-…`, `a-…`). Options accept repeated or comma-separated values.
- Without a query, uses code changes against the target branch. Exit 2 means no code changes or an unclear branch; supply `--paths` explicitly.

## Interpret `data`

| Field | Meaning and action |
| --- | --- |
| `records` | Most relevant first; includes `id`, `kind`, `title`, `status`, `reasons`, and full `text`. Read each scope: an id/path/topic match is only a hint. |
| `status: active` | Merged into the target branch; a current rule. |
| `status: pending` | Approved by this task, unmerged; applies only here. |
| `status: unknown` | Target branch unresolved (`merge.reason`); treat as a likely rule, disclosing unconfirmed state. |
| `excluded` | Relevant records outside count/token limits. Inspect `items`; retrieve important ones with `--ids`. |
| `inactive` | Requested superseded/deprecated records; history, not rules. Follow `supersededBy`. |
| `pendingWarnings` | Other tasks' approved, unmerged add/update/supersede/deprecate changes. Neither follow nor work around them; report conflicts. |
| `merge` | Checked branch (`ref`) and last fetch (`fetchedAt`). No automatic fetch; disclose stale/null dates when merge state matters. Fetch only with user agreement. |
| `missing` | Requested ids not found. |
| `errors` | Unreadable records; report without repairing them. |

## Apply and report

- Only `active` and this task's `pending` records are confirmed rules. Cite ids when following or departing from a record; disclose `unknown` status when relying on it.
- To contradict an active record, stop and ask the user. Propose its replacement in the handoff.
- Empty `records` means no match for the named paths/topics, not that no decision exists.
- Disclose omissions from `excluded.count`, `missing` or `errors`; do not claim exhaustive coverage.
- Use this skill to read rules, not working-tree `.heirloom/` files, which do not establish merge or supersession status. Never hand-edit `.heirloom/`.
