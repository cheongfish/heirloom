---
name: prepare-handoff
description: "Use before reporting spec-based implementation and final review complete, or when the user requests a handoff."
---

# Prepare Handoff

Freeze finished work, draft from frozen inputs, and submit for human dashboard approval. Mechanical checks establish neither approval nor correctness.

Run scripts from inside the repository; output follows the `using-heirloom` JSON convention.

## 1. Freeze the inputs

```sh
node <this skill>/scripts/prepare.mjs --spec <spec path> [--review <review path>] [--reviewed-commit <sha>] \
  [--material design:<path>] [--material plan:<path>] [--sdlc-ref <id>] [--base <branch>]
```

Pass the actual spec, final review file (`--review`) if available, and reviewed commit. Never guess the branch, task id or review commit; unknowns stay unknown. For user-requested work without a spec, replace `--spec` with `--manual`.

Read the result:

- `alreadyPrepared: true`, `state` `awaiting_approval` or later: report the existing handoff and stop without drafting.
- `ok: false`: report `error.message` and `error.hint`; stop. `E_INPUT` (exit 2) requires clarification, not guessing; `E_CONFLICT` (3) means concurrent processing; `E_TRANSIENT` (75) already retried, so do not rerun.
- Otherwise use `taskId`, `draftPath`, `source.files`, `materials`, `unknowns`, `relatedRecords`, and `reviewMatchesSource`.
- Non-null `recheck`: use section 2.1 for previously approved work changed since approval.
- `conversation.path` freezes the user's typed messages. If `available: false`, continue with document sources and report `reason`: `no_session` (no recorded session), `ambiguous` (concurrent sessions), `unreadable`, or `empty`.

Only hooks record sessions. Never manufacture conversation input, write `~/.heirloom/` files or call library modules directly. If conversation evidence is needed, the user starts a new session or ends the competing one; then rerun `prepare`.

## 2. Write the draft

Write JSON to `draftPath`:

```json
{
  "schemaVersion": 1,
  "taskId": "<taskId>",
  "inputSourceHash": "<source.hash>",
  "summary": [{ "text": "<change in the project's language>", "codePaths": ["src/changed-file.mjs"] }],
  "records": [
    {
      "op": "add",
      "kind": "decision",
      "title": "<choice as a sentence>",
      "body": { "problem": "...", "choice": "<choice and reason>", "alternatives": "<rejected options>", "scope": "..." },
      "codePaths": ["src/**/*.mjs"],
      "topics": ["..."],
      "sources": [{ "ref": "docs/specs/x.md", "lines": [12, 14], "quote": "<exact text from those lines>" }]
    }
  ],
  "missing": ["<expected missing material>"],
  "conflicts": [{ "refs": ["a.md", "b.md"], "note": "<disagreement>" }],
  "notes": ""
}
```

### Summary and records

- Write about three summary bullets describing actual changes; link each to changed code files in `source.files`.
- Add decisions only when a document or typed user message explicitly states both choice and reason. Quote exactly, with line ranges for documents. Do not infer reasons or record unwritten agreements, formatting rules, agent preferences or improvement ideas.
- Empty `records` is normal and gets quick approval.
- Record `codePaths` describe applicable code; no `.md`, `.mdx` or `.markdown` in any `codePaths`. Documents belong in `sources`.
- Conversation citations use `{"ref": "@conversation", "quote": "<exact text from one message>"}`, without `lines`. Read `conversation.path`; cite only user text, never agent/tool output. A bare agreement to your proposal is insufficient: omit the decision and explain in `notes`. Cite documents too when they state the same decision.
- Replace a `relatedRecords` entry with `{"op": "supersede", "target": "<old id>", "reason": "...", "with": <index of the add>}`.
- Retire without replacement with `{"op": "deprecate", "target": "<id>", "reason": "...", "sources": [...]}`.
- Propose axiom changes separately; never deactivate one as a decision's side effect.
- List disagreements in `conflicts` without choosing a winner, and expected missing material in `missing`; continue the handoff.
- If `reviewMatchesSource` is false, report that code changed after review without judging it an error.

### 2.1 Incremental recheck draft

Read output `recheck` and `inputPath`'s `recheck.baseline` (approved items including human edits).

- `recheck.changes`: `edited` means branch edits; `base_updated` means a target-branch rebase/merge also changed the file.
- `recheck.affected.summary` / `.records` list items for recheck with reasons. `unlinked` changes make the whole summary subject to recheck.
- Start with every baseline item, each tagged `"baseIndex": <baseline position>`. Preserve unaffected items exactly; they retain approval and cannot be changed or dropped.
- Rewrite, keep or remove affected items to fit current code. New items have no `baseIndex`.
- Read surrounding code and related records. Add overlooked items to the affected set with reasons (including uncertainty); never remove items from that set:

```json
"recheck": { "extra": [{ "kind": "record", "baseIndex": 2, "reason": "<why this change may affect it>" }] }
```

Keep supersede `with` indexes pointing to the same replacement in the new draft. Check whether approved descriptions/decisions still fit; do not re-review implementation.

## 3. Submit

```sh
node <this skill>/scripts/submit-draft.mjs --task <taskId>
```

- `E_VERIFY` (exit 4): fix errors at the reported JSON paths and resubmit; stop after two fix rounds and report remaining errors.
- `E_CONFLICT` "소스가 바뀜": repeat step 1 and rewrite from the new inputs.
- Success: `awaiting_approval`; starts the dashboard and attempts browser opening once per task. Use `dashboardUrl`; `browserOpened: false` and `browserNote` explain skipped/failed opening.
- `dashboardError`: handoff is saved and awaiting approval despite startup failure. Report its message and hint.

## 4. Wait for the approval in the background

If the host supports background commands that wake you on completion (Claude Code: Bash `run_in_background`), start once per handoff immediately after submit:

```sh
node <this skill>/scripts/wait-approval.mjs --task <taskId>
```

Never wait in the foreground. Without this host capability, skip; the next session start lists approvals. Default timeout is 60 minutes (`--timeout-minutes` overrides).

On completion, handle `data.state`:

| Result | Action |
| --- | --- |
| `approved` | Run `apply-approval` immediately; approval authorizes it, so do not ask again. |
| `applied`, `pr_created` | Report already applied elsewhere. |
| `discarded`, `expired` | Report; do not apply. |
| `stale` | Report code changed during review. After changes finish, rerun this skill for incremental recheck. |
| `timedOut: true`, still `awaiting_approval` | Report no approval yet; it remains applicable later. |

## 5. Report

Report immediately after starting the wait (or skipping it):

- Ready, awaiting approval; never claim approved.
- Approval location: `dashboardUrl` or `dashboardError` hint; readable copy: `handoffPath`.
- Warnings, unknowns, and `conversation.reason` if unavailable conversation excluded a decision.

You may end the session; saved approval can be applied later. If a wait was started, say you will apply approval when it arrives.
