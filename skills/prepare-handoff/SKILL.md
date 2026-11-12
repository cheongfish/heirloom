---
name: prepare-handoff
description: "Use before reporting that spec-based implementation and final review are finished, or when the user asks to hand off the current work. Freezes the work scope, drafts the PR summary and decisions, and registers them for human approval."
---

# Prepare Handoff

Hand off finished work for human approval. The flow has three steps:

1. Heirloom freezes the inputs.
2. You write a draft from those frozen inputs.
3. Heirloom checks the draft mechanically.

A human then approves it in the dashboard. A handoff is not an approval, and it is not proof that the work is correct.

The scripts are in this skill's `scripts/` directory. Run them from inside the repository. Each prints exactly one JSON object (see the `using-heirloom` convention).

## 1. Freeze the inputs

```sh
node <this skill>/scripts/prepare.mjs --spec <spec path> [--review <review path>] [--reviewed-commit <sha>] \
  [--material design:<path>] [--material plan:<path>] [--sdlc-ref <id>] [--base <branch>]
```

- Pass the spec you worked from. If the final review is a file, pass it as `--review`. Pass the commit the final review covered as `--reviewed-commit`.
- Only pass values you know. Never guess the target branch, the task identifier or the review commit. Unknown values are recorded as unknown.
- For a handoff the user asked for on work without a spec, use `--manual` instead of `--spec`.

Read the result:

- `alreadyPrepared: true` with `state` `awaiting_approval` or later: this state was already handed off. Tell the user and stop. Do not write a new draft.
- `ok: false`: report `error.message` and `error.hint` to the user and stop.
  - `E_INPUT` (exit 2): for example, the target branch is unclear. Ask the user. Do not pick a branch yourself.
  - `E_CONFLICT` (exit 3): the same work is being processed.
  - `E_TRANSIENT` (exit 75): the script already retried. Do not run it again.
- Otherwise continue with `taskId`, `draftPath`, `source.files`, `materials`, `unknowns`, `relatedRecords` and `reviewMatchesSource`.
- `recheck` is not null: this task was approved before and the code or materials changed since. Write an incremental draft (section 2.1) instead of a new one.

## 2. Write the draft

Write JSON to `draftPath`:

```json
{
  "schemaVersion": 1,
  "taskId": "<taskId>",
  "inputSourceHash": "<source.hash>",
  "summary": [{ "text": "<one change, in the project's language>", "codePaths": ["src/changed-file.mjs"] }],
  "records": [
    {
      "op": "add",
      "kind": "decision",
      "title": "<the choice, as a sentence>",
      "body": { "problem": "...", "choice": "<choice and reason>", "alternatives": "<rejected options>", "scope": "..." },
      "codePaths": ["src/**/*.mjs"],
      "topics": ["..."],
      "sources": [{ "ref": "docs/specs/x.md", "lines": [12, 14], "quote": "<exact text from those lines>" }]
    }
  ],
  "missing": ["<material that should exist but does not>"],
  "conflicts": [{ "refs": ["a.md", "b.md"], "note": "<what disagrees>" }],
  "notes": ""
}
```

### Summary

- Write about three bullets, each describing a real change in this work.
- `codePaths` lists the changed **code** files that each bullet is based on, taken from `source.files`.

### Records

- Add a decision only when a source document explicitly states both the choice and its reason.
  - Quote that text exactly in `quote`, and give the line range it appears in.
  - Do not infer reasons. Do not record agreements that are not written down.
  - Do not turn formatting rules, your own preferences or improvement ideas into decisions.
- A draft with no records is normal. It gets a one-step quick approval.
- `codePaths` on a record are the code paths the decision applies to.
  - Never put Markdown documents (`.md`, `.mdx`, `.markdown`) in any `codePaths`.
  - Documents belong in `sources` only.
- To replace an existing record from `relatedRecords`, use `{"op": "supersede", "target": "<old id>", "reason": "...", "with": <index of the add>}`.
- To retire a record without a replacement, use `{"op": "deprecate", "target": "<id>", "reason": "...", "sources": [...]}`.
- Never deactivate an axiom as a side effect of a decision. Propose axiom changes as their own records.

### Gaps and conflicts

- When sources disagree, record the disagreement in `conflicts`. Do not pick a winner.
- When expected material is missing, list it in `missing`. The handoff still goes ahead.
- When `reviewMatchesSource` is false, the code changed after the final review. State that as a fact. Do not judge it as an error.

### 2.1 Incremental recheck draft

When `recheck` is not null, the human already approved this task once. Only the approved items that the change touches go back to the human. Read `recheck` in the output and `recheck.baseline` in `inputPath` (the approved summary and records, with the human's edits).

- `recheck.changes` lists the files changed since the approval. `base_updated` means the target branch was rebased or merged in and also changed that file, so the task file's content differs from the approved one partly because of the target branch. `edited` is a change made in this branch.
- `recheck.affected.summary` and `recheck.affected.records` are the baseline items up for recheck, with reasons. `unlinked` lists changed files linked to no item; then the whole summary is up for recheck.
- Start from the baseline. Copy every baseline bullet and record into the draft and give each one `"baseIndex": <its position in the baseline>`.
- **Copy items that are not up for recheck exactly as they are.** The check refuses a draft that changes or drops them. They keep their approval.
- Rewrite, keep, or remove the items that are up for recheck, so that they describe the current code. New bullets and new records have no `baseIndex`.
- Read the surrounding code and the related records, not only the changed lines. If you think a change touches an item that is not listed, add it with a reason. You can add items but not remove listed ones:

```json
"recheck": { "extra": [{ "kind": "record", "baseIndex": 2, "reason": "<why the change may touch it; say if you are unsure>" }] }
```

- A supersede's `with` is the index in the new draft. Keep it pointing at the same replacement.
- This is not a second review of the implementation. Check only whether the approved description and decisions still fit the code.

## 3. Submit

```sh
node <this skill>/scripts/submit-draft.mjs --task <taskId>
```

- `E_VERIFY` (exit 4): the message lists each error with its JSON path. Fix them in `draftPath` and submit again. Stop after two rounds of fixes, and report the remaining errors to the user.
- `E_CONFLICT` "소스가 바뀜": the code changed after step 1. Run step 1 again and rewrite the draft from the new result.
- On success the state is `awaiting_approval`. The script also starts the dashboard and opens the browser the first time for this task.
  - `dashboardUrl`: the task screen. `browserOpened` is false when the browser was already opened for this task, automatic opening is turned off, or no browser command worked (`browserNote` says which).
  - `dashboardError` is set when the dashboard could not start, for example because another program uses its port. The handoff is still saved and waiting. Pass the message and the hint to the user.

## 4. Wait for the approval in the background

If your host can run a command in the background and wake you when it ends (in Claude Code: the Bash tool with `run_in_background`), start this right after a successful submit, once per handoff:

```sh
node <this skill>/scripts/wait-approval.mjs --task <taskId>
```

Do not wait in the foreground. If your host has no background commands, skip this step. The next session start lists the approval instead.

It ends when the human answers or after 60 minutes (`--timeout-minutes` changes this). When it ends, read `data.state`:

- `approved`: the human's approval is the request to apply it. Run the `apply-approval` skill now. Do not ask first.
- `applied` or `pr_created`: it was already applied elsewhere. Tell the user.
- `discarded` or `expired`: tell the user. Do not apply.
- `stale`: the code changed while the human was reviewing. Tell the user. When the change is finished, run this skill again: it starts an incremental recheck.
- `timedOut: true` (still `awaiting_approval`): tell the user that no approval came yet. It can be applied later, because the next session start lists it.

## 5. Report

Report right after step 4 starts the wait. Do not wait for it to end first.

Tell the user three things:

- The handoff is ready and waiting for their approval.
- Where to approve it: `dashboardUrl`, or the `dashboardError` hint when the dashboard did not start. Mention `handoffPath` as the readable copy.
- Any warnings and unknown values.

Do not say the work is approved. The approval may come hours later. You can end the session, because `apply-approval` continues from the saved approval. If you started the wait, say that you will apply the approval when it comes.
