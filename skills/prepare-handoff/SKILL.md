---
name: prepare-handoff
description: "Use before reporting spec-based implementation and final review complete, or when the user requests a handoff."
---

# Prepare Handoff

Freeze finished work, run probes on base and head, draft questions from the recorded outputs, and submit for human dashboard approval. Mechanical checks establish neither approval nor correctness.

Run scripts from inside the repository; output follows the `using-heirloom` JSON convention.

## 1. Freeze the inputs

```sh
node <this skill>/scripts/prepare.mjs --spec <spec path> [--review <review path>] [--reviewed-commit <sha>] \
  [--material design:<path>] [--material plan:<path>] [--sdlc-ref <id>] [--base <branch>]
```

Pass the actual spec, final review file (`--review`) if available, and reviewed commit. Never guess the branch, task id or review commit; unknowns stay unknown. For user-requested work without a spec, replace `--spec` with `--manual`.

Read the result:

- `alreadyPrepared: true`, `state` `awaiting_approval` or later: report the existing handoff and stop without drafting.
- `alreadyPrepared: true`, `state` `returned`: nothing changed since the person sent the work back. Fix what `previousJudgment` lists first, then run this skill again.
- Non-null `previousJudgment`: the last judgment returned these questions (`verdict` `revert`: the behavior is wrong; `split`: move it out of this branch), with the person's `reason`. This round must address each one; ask about the changed behavior again. When a returned question cited the spec, `spec.choice` says what the spec becomes, and `spec.parts` lists the cited lines:
  - `spec-wrong`: the behavior should never have been there. Fix or remove the cited lines and leave one line `거절: <reason>` in their place.
  - `defer`: right, but not in this change. Mark the cited lines themselves with `보류: <follow-up issue, or the reason>`.
  - `snapshot`: leave the spec alone; the PR paragraph will say the cited part is not implemented.

  For `spec-wrong` and `defer`, submit refuses the draft while the cited lines are still there word for word: change text inside the cited lines, not only next to them. Cite the edited lines (not the old quote) if a question still rests on that spec part.
- `ok: false`: report `error.message` and `error.hint`; stop. `E_INPUT` (exit 2) requires clarification, not guessing; `E_CONFLICT` (3) means concurrent processing; `E_TRANSIENT` (75) already retried, so do not rerun.
- Otherwise use `taskId`, `draftPath`, `source.files`, `materials`, `unknowns`, `relatedRecords`, and `reviewMatchesSource`.
- Non-null `recheck` (`kind: "probes"`): the work was judged before and changed since. Run the probes file of the last round again (add probes for every path in `recheck.unlinked`, the changed code no behavior description pointed at), then write a full draft for the current state. Keep the id and exact wording of each question that still holds: a question asked the same way whose probe outputs did not change keeps its verdict and is not asked again. Rewrite or drop what no longer holds.
- Non-null `openPr` with a `recheck`: the PR's judgment no longer covers the code. Before drafting, mark its paragraph: fetch the PR body into a file (`gh pr view <url> --json body -q .body`, or `glab api` for an MR), run `node <apply-approval skill>/scripts/pr-body.mjs --task <taskId> --body-file <file> --rechecking`, and update the PR body with it as `apply-approval` step 4 shows. This changes only Heirloom's paragraph.
- `relatedRecords`: decision records (`id`, `choice`, `scope`) whose `scope` covers a changed file. Read them with `recall-context`. If the change contradicts one, say so in a `fork` question and in the report; do not drop the question.
- `conversation.path` freezes the user's typed messages. If `available: false`, continue with document sources and report `reason`: `no_session` (no recorded session), `ambiguous` (concurrent sessions), `unreadable`, or `empty`.

Only hooks record sessions. Never manufacture conversation input, write `~/.heirloom/` files or call library modules directly. If conversation evidence is needed, the user starts a new session or ends the competing one; then rerun `prepare`.

## 2. Run probes

A probe is a command whose output shows what this change does. Heirloom runs every probe on the base (the frozen merge-base) and on the head (the handed-off state, uncommitted changes included), each in a temporary worktree, and records the outputs. Observed values in the draft must come from these runs.

Write a probes file outside the repository (for example next to `draftPath`):

```json
{
  "probes": [
    { "id": "p1", "title": "12개 구매 결제액", "run": ["node", "-e", "import('./src/cart.mjs').then((m) => console.log(m.total({ qty: 12, unit: 10 })))"] }
  ],
  "tests": { "command": ["node", "--test", "--test-reporter=tap"], "parser": "node-tap" }
}
```

- Pick inputs that go through the changed code: boundaries, the cases the spec names, the cases a reviewer would doubt. Print the observed value plainly; one value per probe reads best.
- `run` is an argument list without a shell, run from the repository root. Use `["sh", "-c", "..."]` only when a shell is needed. At most 10 probes; `timeoutSeconds` (default 30) per probe.
- A probe of new code fails on the base. That is expected; keep it.
- `tests`: the project's test command with `parser` `node-tap` (`node --test --test-reporter=tap`), `pytest` (`pytest -v`), `jest-json` (`jest --json --testLocationInResults`) or `exit-code`.
- `setup`: commands run once in each worktree before the probes, for example `[["npm", "ci"]]`. The worktrees have no ignored files such as `node_modules`. The project setting `probe.setup` is used when the file has none.

```sh
node <this skill>/scripts/probe.mjs --task <taskId> --file <probes file>
```

Read `probes` (outputs per side, `sameOutput`), `tests.changed` (tests whose result differs), `warnings` and `probeSetHash`. If every probe shows the same output on both sides, or a probe fails for a reason unrelated to the change (missing setup, wrong path), fix the probes file and run it again. The last run is the one the draft is checked against.

## 3. Write the draft

Write JSON to `draftPath`:

```json
{
  "schemaVersion": 2,
  "taskId": "<taskId>",
  "inputSourceHash": "<source.hash>",
  "probeSetHash": "<probeSetHash of the last probe run>",
  "behaviorDiffs": [
    { "text": "12개 구매 결제액이 108에서 120이 된다", "probes": ["p1"], "codePaths": ["src/cart.mjs"] }
  ],
  "questions": [
    { "id": "q1", "kind": "predict", "probe": "p1", "prompt": "단가 10원으로 12개를 사면 결제액은?", "answerType": "number" },
    { "id": "q2", "kind": "test-lock", "test": "test/cart.test.mjs:41", "plain": "100개 이상이면 10% 할인된다", "prompt": "이 테스트는 12개 구매의 결제액을 확인하나요?" },
    { "id": "q3", "kind": "intent", "probe": "p1", "sources": [{ "ref": "docs/specs/cart.md", "lines": [40, 52], "quote": "10개 이상 구매하면 대량 할인을 적용한다" }], "prompt": "spec의 의도와 실제 결과가 같나요?" },
    { "id": "q4", "kind": "fork", "probes": ["p1"], "codePaths": ["src/cart.mjs"], "prompt": "12개 구매에 할인을 적용해야 하나요?", "whyOpen": "할인 경계를 정한 이유가 코드, 테스트, 커밋에 없다" }
  ],
  "inferences": [{ "text": "<a behavior claim no probe shows>", "reason": "<why it could not be run>" }],
  "notes": ""
}
```

Write the texts in the project's language.

### Behavior differences

- One entry per behavior that differs between base and head, in plain words a reviewer understands without the code. Cite the probes that show it; link changed code files from `source.files` (no Markdown).
- Every number and every string in double quotes must appear in the cited probes' commands or outputs. Copy observed values; never round, compute or recall them.
- A claim no probe shows goes to `inferences` with the reason, never to `behaviorDiffs`.

### Questions

Ask 3 to 5 questions about what the person most likely does not know yet. The person answers before the dashboard shows the observed values.

| Kind | Asks | Needs |
| --- | --- | --- |
| `predict` | the head result of a probe input. `answerType` `number`, `text`, or `choice` with `choices` | `probe` |
| `test-lock` | whether a test, read in plain words, guards this change's behavior | `test`: a name from `tests.changed`, or `<file>:<line>` in a test file this change touched; `plain`: what the test asserts |
| `intent` | whether the spec or the user's words match the actual behavior | `probe`, `sources` with exact quotes |
| `fork` | a choice the code and tests leave open | `probes`, `codePaths`, `whyOpen`: why the choice is open (no reason in code, tests or commits) |

- Prefer probes whose outputs differ and behaviors a reviewer could get wrong. Do not ask what the prompt already gives away.
- Any question may cite `sources`. Documents: `{"ref": "<path>", "lines": [from, to], "quote": "<exact text from those lines>"}`. Conversation: `{"ref": "@conversation", "quote": "<exact text from one message>"}`, without `lines`. Read `conversation.path`; cite only text the user typed, never agent or tool output. A bare agreement to your proposal is not a stated choice.
- Ask a `fork` question only for a choice the change makes without a stated reason. A document or typed user message that states both the choice and the reason settles it: cite it in an `intent` question instead.
- If `reviewMatchesSource` is false, report that code changed after review without judging it an error.

### Decision records

A `fork` answer stays in the PR body unless the person keeps it in the repository. They can only do that when the question carries a `decision` proposal:

```json
"decision": {
  "scope": ["src/cart/**"],
  "anchors": [
    { "file": "src/cart.mjs", "symbol": "total" },
    { "file": "test/cart.test.mjs", "test": "small orders pay full price" }
  ],
  "replaces": "d-…"
}
```

- Propose one only for a choice later work on that code must keep. Most answers belong in the PR alone; a record every few PRs at most is normal.
- `anchors` say where the code holds the choice now: a `symbol` in a file, and at least one `test` that locks it, named as the probe run's test results name it and passing on head. If no test locks the choice yet, write that test first, run the probes again, then draft.
- `scope`: code globs whose changes must respect the decision. Never Markdown.
- `replaces`: an existing decision record (`d-…`, schema 2) this choice replaces; it is removed in the same PR.
- To ask whether a `possibly-stale` record (see `recall-context`) still holds, set `"retires": "d-…"` on the `fork` question. The person may retire it; it is then removed in this PR.
- Records written before 0.4 (schema 1 decisions, axioms) cannot be replaced or retired this way.

A decision settled in a PR review or issue discussion, with no trace in code, tests or commits, can be offered as a top-level `discussions` entry:

```json
"discussions": [
  {
    "id": "x1",
    "url": "https://github.com/<owner>/<repo>/pull/42#discussion_r123",
    "quote": "<exact sentence from that comment>",
    "choice": "<the decision in one line>",
    "scope": ["src/cart/**"],
    "anchors": [{ "file": "test/cart.test.mjs", "test": "small orders pay full price" }]
  }
]
```

- Only a decision the discussion actually settled, quoted from a human comment. Never your own inference, and never a bare agreement to a proposal.
- `url`: a comment (`#issuecomment-…`, `#discussion_r…`, `#pullrequestreview-…`, GitLab `#note_…`) or the PR, MR or issue description, in this repository. Submit fetches it with `gh` or `glab` and refuses a quote it does not contain, so those CLIs must be logged in.
- `anchors`, `scope`, `replaces` follow the same rules as a `decision` proposal. The person confirms each entry; an unconfirmed one is dropped without sending the work back.

## 4. Submit

```sh
node <this skill>/scripts/submit-draft.mjs --task <taskId>
```

- `E_VERIFY` (exit 4): fix errors at the reported JSON paths and resubmit; stop after two fix rounds and report remaining errors.
- `E_CONFLICT` "소스가 바뀜": repeat steps 1 and 2 and rewrite from the new inputs.
- Success: `awaiting_approval`; starts the dashboard and attempts browser opening once per task. Use `dashboardUrl`; `browserOpened: false` and `browserNote` explain skipped/failed opening.
- `dashboardError`: handoff is saved and awaiting approval despite startup failure. Report its message and hint.

## 5. Wait for the approval in the background

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
| `stale` | Report code changed during review. After changes finish, rerun this skill for a recheck. |
| `returned` | The person sent the work back; `data.returned` lists the questions and reasons. Report them, change the code (for `split`, move that behavior out of this branch), then rerun this skill. Do not open a PR. |
| `timedOut: true`, still `awaiting_approval` | Report no approval yet; it remains applicable later. |

## 6. Report

Report immediately after starting the wait (or skipping it):

- Ready, awaiting approval; never claim approved.
- Approval location: `dashboardUrl` or `dashboardError` hint; readable copy: `handoffPath`.
- Warnings, unknowns, and `conversation.reason` if unavailable conversation excluded a decision.

You may end the session; saved approval can be applied later. If a wait was started, say you will apply approval when it arrives.
