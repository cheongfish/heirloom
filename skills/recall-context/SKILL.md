---
name: recall-context
description: "Use once the current task is known, to fetch the full text of active decisions and axioms related to the files or topics being changed."
---

# Recall Context

The session start shows only an index of decisions and axioms. Before you rely on a record, or before you change code that a record covers, read its full text with this skill.

## When to run it

- Once you know which files you will change, before you start changing them. Pass the files you are about to change with `--paths` even if you have not changed anything yet, and the subject of the task with `--topics` when it matches topics in the index.
- When the user or a spec refers to a decision or axiom id.
- When the index marks a decision `[관련]` (related to the current changes).

Run it again if the scope of the task grows into other files. Do not run it repeatedly for the same query.

## Run

```sh
node <this skill>/scripts/recall.mjs [--paths <path,...>] [--topics <topic,...>] [--ids <id,...>] [--limit <n>]
```

- `--paths`: repository-relative code files or directories you will change. Do not pass Markdown documents: records never point at them.
- `--topics`: topic words of the records (as listed in their `topics`).
- `--ids`: record ids such as `d-7k3q9m2x` or `a-2b8n4k1q`.
- Each option may be repeated or given comma-separated values.
- With no query, the code files changed against the target branch are used. If the target branch is unclear, or no code file has changed yet, the script fails with exit 2. Then pass `--paths` yourself.

## Read the result

`data` contains:

- `records`: the selected records, most relevant first. Each has `id`, `kind`, `title`, `status`, `reasons`, and `text` (the whole record file).
  - `status: "active"`: merged into the target branch. This is a current rule.
  - `status: "pending"`: approved by this task and not merged yet. It applies to this task only.
  - `status: "unknown"`: the target branch could not be resolved, so merge state is unknown (`merge.reason`). Treat the record as a likely rule and tell the user that the state is unconfirmed.
  - `reasons` explain the match (`id`, `path:<path>`, `topic:<topic>`). A path match is a hint, not proof. Read the record's scope section and decide whether it really applies.
- `excluded`: records that were relevant but did not fit the count or token limit (`items` lists them). If one of them looks important, run again with `--ids` for it.
- `inactive`: records you asked for by id that are superseded or deprecated. They are history, not rules. Follow `supersededBy` to the record that replaced them.
- `pendingWarnings`: changes that **another** task approved and that are not merged yet (`change` is `add`, `update`, `supersede` or `deprecate`). They are not rules yet. Do not follow them and do not work around them. If one conflicts with your work, tell the user.
- `merge`: what the statuses were checked against (`ref`) and when this repository was last fetched (`fetchedAt`). The script never fetches. If merge state matters and `fetchedAt` is old or null, tell the user. Do not run `git fetch` unless the user agrees.
- `missing`: requested ids that do not exist here.
- `errors`: record files that could not be read. Report them to the user. Do not fix record files yourself.

## Report what was checked

When you tell the user which records apply, say how far the check went:

- No `records` means nothing matched this query. Name the paths or topics you used. Do not say that no decision exists.
- If `excluded.count`, `missing` or `errors` is not empty, do not say that you checked all related records. Say what was left out or could not be read.
- A record with `status: "unknown"` is not a confirmed rule. Say so when you rely on it.

## Rules

- Treat only `active` records, and `pending` records of this task, as rules.
- Quote the record id when your work follows or departs from a record.
- If your work must contradict an active record, stop and ask the user. A new decision that replaces it is proposed in the handoff, not by editing the record.
- Read records through this skill, not by opening files under `.heirloom/`. The files in the working tree do not tell you whether a record is merged, superseded or pending.
- Never edit files under `.heirloom/` by hand.
