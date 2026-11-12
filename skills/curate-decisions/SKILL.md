---
name: curate-decisions
description: "Use only inside a Heirloom curation worktree (~/.heirloom/worktrees/...), when the dashboard started a context curation or the user asks to curate there. Reviews a batch of unreviewed decisions, proposes duplicate clean-up, relations and axiom candidates, and registers them for human approval."
---

# Curate Decisions

Each handoff records the decisions of one piece of work. Over time decisions repeat, overlap, or turn out to share one rule. A context curation looks at a batch of decisions nobody has reviewed together yet, and proposes:

- clean-up of duplicates (supersede or deprecate),
- relations between existing records (exception or coexistence, with a condition),
- changes to existing axioms,
- new axiom candidates: a rule worth keeping, backed by two or more decisions.

A human approves each proposal in the dashboard. Curation never changes a record by itself, and an approved proposal becomes active only when its pull request is merged.

Run this skill only in the dedicated worktree the dashboard created for the curation. The user's own working trees are never touched. If you are not in such a worktree, `prepare-curation.mjs` says so: stop and tell the user to start the curation from the dashboard.

The scripts print exactly one JSON object each (see the `using-heirloom` convention).

## 1. Freeze the input

```sh
node <this skill>/scripts/prepare-curation.mjs
```

Read the result:

- `ok: false`: report `error.message` and `error.hint` and stop.
- `alreadyPrepared: true` with `state` `awaiting_approval` or later: the draft is already submitted. Stop.
- Otherwise continue with `taskId`, `draftPath`, `inputSourceHash` (copy it into the draft), and the three lists:
  - `batch`: the unreviewed decisions this run reviews (id, title, record file).
  - `related`: active decisions linked to the batch by code path, topic or relation.
  - `axioms`: every active axiom.
- `closedCandidates`: axiom candidates a human held or rejected before, with the reason and the evidence they had.

Read every record file in `batch`, `related` and `axioms` in full, and the original sources they cite when you need them. Judge from the text, not from titles.

## 2. Write the draft

Write JSON to `draftPath`, in the same format as `prepare-handoff` (read its SKILL.md, section 2, for the fields), with these differences.

### Summary

The summary becomes the pull request description of the curation. Write one to three bullets that describe what the curation proposes, for example "Merged two duplicate decisions about rounding". `codePaths` may be empty: a curation changes no code.

### Axiom candidates

An axiom is a rule to keep, not a category of decisions. Repetition is a signal, not proof.

- Propose a candidate only when two or more decisions keep the **same property** for the same reason. When similar decisions made different choices in different situations, there is no common rule. Do not force one.
- Extract the property to keep, not the implementation.
- Before you propose a new axiom, check the existing `axioms`. When the decisions are cases of an existing axiom, propose an `update` of that axiom (scope, exceptions or checks) or a `relate` instead of a new one.
- Do not propose again a candidate from `closedCandidates` unless you have new evidence: the check refuses a candidate whose evidence is all contained in the evidence of a held or rejected one.

```json
{
  "op": "add",
  "kind": "axiom",
  "title": "<the rule, as a sentence>",
  "body": {
    "property": "<the property every later change keeps>",
    "scope": "<where and when it applies>",
    "exceptions": "<known exceptions and conflicting records, by id>",
    "checks": "<how a later change can check that it keeps the rule>"
  },
  "codePaths": ["src/money/**"],
  "topics": ["rounding"],
  "evidence": ["d-…", "d-…"],
  "sources": [{ "ref": ".heirloom/decisions/d-….md", "quote": "<exact text from that file>" }]
}
```

- `evidence` lists the decision ids the rule comes from: at least two, all from `batch` or `related`.
- `sources` quote the evidence: the decision record files themselves, or the original documents they cite. Quotes must be exact.

### Other proposals

- Duplicates: `supersede` the older record with a new merged `add`, or `deprecate` one that adds nothing. Give the reason.
- Relations: when two active records both hold, each under a condition, relate them. The condition is required:

  ```json
  { "op": "relate", "target": "d-…", "relation": { "type": "exception", "id": "d-…", "condition": "<when the exception applies>" } }
  ```

  Use `exception` when `id` is an exception to `target`, and `coexist` when both apply side by side.
- Never deactivate an axiom as a side effect. Propose axiom changes as their own records.

### Nothing to propose

A draft with no records is a valid result: the batch was reviewed and nothing needed to change. The review is still recorded, so these decisions are not offered for curation again.

## 3. Submit

```sh
node <prepare-handoff skill>/scripts/submit-draft.mjs --task <taskId>
```

- `E_VERIFY` (exit 4): fix the listed errors in `draftPath` and submit again. Stop after two rounds of fixes and report the remaining errors.
- On success, stop. Do not wait for the approval. The human reviews each proposal in the dashboard, and gives a reason for every candidate they hold or reject.

## 4. After the approval

When the dashboard started this curation, it also starts the next step after the approval: it runs the `apply-approval` skill in this worktree, which writes the records and the review history (`.heirloom/curation/c-<id>.json`), commits them, pushes the branch and opens the pull request.

When the user runs the curation by hand, they run `/apply-approval` in this worktree after approving.
