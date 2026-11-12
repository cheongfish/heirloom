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

## 3. Submit

```sh
node <this skill>/scripts/submit-draft.mjs --task <taskId>
```

- `E_VERIFY` (exit 4): the message lists each error with its JSON path. Fix them in `draftPath` and submit again. Stop after two rounds of fixes, and report the remaining errors to the user.
- `E_CONFLICT` "소스가 바뀜": the code changed after step 1. Run step 1 again and rewrite the draft from the new result.
- On success the state is `awaiting_approval`.

## 4. Report

Tell the user three things:

- The handoff is ready and waiting for their approval.
- Where the handoff file is (`handoffPath`).
- Any warnings and unknown values.

Do not say the work is approved. The approval may come hours later. You can end the session, because `apply-approval` continues from the saved approval.
