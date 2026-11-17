---
name: recall-context
description: "Use before changing covered files or relying on a decision; retrieves applicable decision records and checks their anchors."
---

# Recall Context

Read full records before relying on them or editing covered code; the session start lists only the covered paths.

## Run

Run when intended files are known and fall under a covered path listed at session start, or a user/spec cites a record id. Repeat for expanded scope, not identical queries.

```sh
node <this skill>/scripts/recall.mjs [--paths <path,...>] [--ids <id,...>] [--limit <n>]
```

- `--paths`: intended repository-relative code files/directories, even before edits. Exclude Markdown documents.
- `--ids`: decision ids (`d-…`). Options accept repeated or comma-separated values. `--topics` only matches records from before 0.4.
- Without a query, uses code changes against the target branch. Exit 2 means no code changes or an unclear branch; supply `--paths` explicitly.

## Interpret `data`

| Field | Meaning and action |
| --- | --- |
| `records` | Decision records, most relevant first: `id`, `choice`, `status`, `anchorCheck`, `anchors`, `reasons`, full `text`. Read each scope: an id/path match is only a hint. |
| `status: active` | Merged into the target branch. |
| `status: pending` | Kept by this task's judgment, unmerged; applies only here. |
| `status: unknown` | Target branch unresolved (`merge.reason`); treat as a likely rule, disclosing unconfirmed state. |
| `anchorCheck: active` | Every anchor is there (file and name; the test exists and did not fail on its last recorded run). Follow it as a rule. |
| `anchorCheck: possibly-stale` | An anchor is gone (`found: false`) or its test failed on the last run (`lastRun.status: fail`). Neither follow nor ignore it: ask the user whether it still holds. If not, ask it in the handoff as a `fork` question with `retires`. |
| `anchors[].lastRun` | The newest probe run of this repository that ran the test; null when none did (presence alone was checked). |
| `excluded` | Relevant records outside count/token limits. Retrieve important ones with `--ids`. |
| `legacy` | Records from before 0.4 (schema 1 decisions, axioms) on these paths: past records, not rules. Read the `file` for background only. |
| `pendingWarnings` | Other tasks' kept-but-unmerged changes (`add`, `retire`; `by` is the replacing record). Neither follow nor work around them; report conflicts. |
| `merge` | Checked branch (`ref`) and last fetch (`fetchedAt`). No automatic fetch; disclose stale/null dates when merge state matters. Fetch only with user agreement. |
| `missing` | Requested ids not found. |
| `errors` | Unreadable records; report without repairing them. |

## Apply and report

- Only `active` and this task's `pending` records with `anchorCheck: active` are confirmed rules. Cite ids when following or departing from a record; disclose `unknown` status when relying on it.
- When a request conflicts with a record, do not overturn it on your own: go as far as the record allows, stop, and tell the user. A replacement goes into the handoff as a `fork` question whose `decision` proposal `replaces` the record.
- Empty `records` means no match for the named paths, not that no decision exists.
- Disclose omissions from `excluded.count`, `missing` or `errors`; do not claim exhaustive coverage.
- Use this skill to read rules, not working-tree `.heirloom/` files, which do not establish merge status. Never hand-edit `.heirloom/`.
