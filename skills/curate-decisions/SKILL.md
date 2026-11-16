---
name: curate-decisions
description: "Use only in a dedicated Heirloom curation worktree when the dashboard or user requests curation."
---

# Curate Decisions

Review a batch of unreviewed decisions for duplicates, conditional relations, axiom updates and new axiom candidates. Humans approve proposals in the dashboard; they become active only after PR merge.

Use only the dashboard-created curation worktree, never the user's working trees. If `prepare-curation.mjs` rejects the location, stop and direct the user to start from the dashboard. Scripts follow the `using-heirloom` JSON convention.

## 1. Freeze the input

```sh
node <this skill>/scripts/prepare-curation.mjs
```

- `ok: false`: report `error.message` and `error.hint`; stop.
- `alreadyPrepared: true` with `state` `awaiting_approval` or later: already submitted; stop.
- Otherwise use `taskId`, `draftPath`, `inputSourceHash` (copy into draft), and:
  - `batch`: unreviewed decisions for this run.
  - `related`: active decisions matched by path, topic or relation.
  - `axioms`: all active axioms.
  - `closedCandidates`: previously held/rejected candidates, reasons and evidence.

Read every record in `batch`, `related` and `axioms` in full, plus cited original sources as needed. Titles alone are insufficient.

## 2. Write the draft

Write JSON to `draftPath`. Read `prepare-handoff` SKILL.md section 2 for the schema; apply these differences.

### Summary

Write one to three bullets describing the proposals for the PR. `codePaths` may be empty because curation changes no code.

### Axiom candidates

An axiom preserves a property, not an implementation or category. Require at least two decisions preserving the same property for the same reason; repetition or different situational choices alone do not establish a rule.

Check existing `axioms` first: if one already covers the cases, propose an `update` (scope, exceptions, checks) or `relate`. Reproposing a held/rejected candidate requires new evidence; evidence wholly contained in a `closedCandidates` entry is rejected.

```json
{
  "op": "add",
  "kind": "axiom",
  "title": "<rule as a sentence>",
  "body": {
    "property": "<property later changes preserve>",
    "scope": "<where and when>",
    "exceptions": "<exceptions and conflicting record ids>",
    "checks": "<how to verify the property>"
  },
  "codePaths": ["src/money/**"],
  "topics": ["rounding"],
  "evidence": ["d-…", "d-…"],
  "sources": [{ "ref": ".heirloom/decisions/d-….md", "quote": "<exact source text>" }]
}
```

`evidence` requires at least two decision ids from `batch` or `related`. `sources` must quote their record files or cited original documents exactly.

### Other proposals

- Duplicates: `supersede` the older record with a merged `add`, or `deprecate` a redundant record; give the reason.
- Conditional relations between active records require a condition:

  ```json
  { "op": "relate", "target": "d-…", "relation": { "type": "exception", "id": "d-…", "condition": "<when it applies>" } }
  ```

  `exception` means `id` is an exception to `target`; `coexist` means both apply side by side.
- Propose axiom changes separately; never deactivate one as a side effect.
- Empty `records` is valid: the review is recorded and the batch will not be offered again.

## 3. Submit

```sh
node <prepare-handoff skill>/scripts/submit-draft.mjs --task <taskId>
```

`E_VERIFY` (exit 4): fix listed draft errors and resubmit; stop after two fix rounds and report remaining errors.

On success, stop without waiting. Humans review each proposal and give reasons for held/rejected candidates.

## 4. After the approval

Dashboard-started curation automatically runs `apply-approval` in this worktree after approval: writes records and `.heirloom/curation/c-<id>.json` review history, commits, pushes and opens the PR.

For manual curation, the user runs `/apply-approval` in this worktree after approving.
