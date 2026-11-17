# Workflow

Heirloom does not do the development work. It takes over work finished with an SDLC tool such as Superpowers and checks, before merge, that a human understands what the change does. It keeps that understanding on the PR (a paragraph and a commit status) and, for the few choices later work must keep, as narrow decision records.

```
1. Handoff and probes  →  2. Predict, reveal, judge  →  3. PR, status, records  →  4. Recall in later work
   (agent, Heirloom)         (human)                      (agent)                    (agent)
```

## 1. Handoff and probes

The agent does this.

- **When.** After finishing the implementation and final review of a spec-based task, and before reporting completion, the agent runs the `prepare-handoff` skill.
- **If the agent forgets.** The stop hook reminds it once. Three conditions must hold: there are code changes linked to a spec, no handoff exists for that state, and no reminder was given for the same state. A spec counts as linked when this branch changed it, and also when the session read a spec that was already on the target branch (checked in the session transcript; how each host records reads is in [Hosts](hosts.md#differences)).
- **If specs live elsewhere.** The stop hook recognizes specs by the spec location setting (`specGlobs`). If yours are elsewhere, add a pattern to `.heirloom/config.json` ([Configuration](configuration.md#project-settings)) and commit it.
- **Work without a spec.** A small fix, a refactor or work asked for in the chat is handed off only when the user asks (`prepare-handoff --manual`). So that a chat-only user learns this, the stop hook tells the agent once per session when there are code changes without a linked spec, and the agent mentions it in one sentence when it reports the work as finished.
- **Steps.**
  1. **Freeze.** Heirloom freezes the source state, the merge-base, the materials (spec, review documents) and the messages the user typed in the session.
  2. **Probes.** The agent writes a probes file: commands whose output shows what the change does, and optionally the test command. Heirloom runs them itself, once in a temporary worktree of the merge-base and once of the head (uncommitted changes included), and records exit codes, output and hashes. With a test command it compares results per test and lists the tests whose result changed (`node --test --test-reporter=tap`, `pytest -v` and `jest --json` are read per test; anything else by exit code only). Expensive preparation such as `npm ci` goes into `probe.setup` ([Configuration](configuration.md#project-settings)).
  3. **Draft.** From the recorded output the agent writes descriptions of the behavior differences and 3 to 5 questions:
     - `predict`: the result of a probe input, which you answer before seeing it;
     - `test-lock`: whether a test, read in plain words, guards this behavior;
     - `intent`: whether the spec or your own words match the actual behavior;
     - `fork`: a choice the code and tests leave open.

     Claims no probe confirms go into a separate "no run evidence" list.
  4. **Check.** Heirloom refuses the draft when a number or quoted value in a description is not in the cited probe output, a probe was not run, a `test-lock` points at a test that neither changed nor was touched, a spec or conversation quote does not match its source, or a decision record proposal or discussion does not hold up ([section 3](#decision-records)).
- **Result.** When the check passes, the dashboard opens, once per task. A readable handoff file (`handoff.md`) is also written; it leaves out observed values so you can still predict.

Which session's messages are frozen: the session start and stop hooks record each session's transcript per worktree, and a handoff takes the session that was active last. When another session of the same worktree ran at the same time within the last two hours, Heirloom does not guess: the handoff goes ahead without the conversation.

A handoff only means the agent reports the work is ready. It is not proof that the work is correct, and it is not an approval.

## 2. Predict, reveal, judge

A human does this. See [Dashboard](dashboard.md) for the screens.

1. **Predict.** For each `predict` and `test-lock` question, write your answer first. Until you save, the server sends no output, behavior description or changed test. Saved predictions cannot be changed.
2. **Reveal.** The probe outputs, the behavior descriptions and the changed tests appear, with each prediction marked right or wrong where a machine can tell.
3. **Judge each question.**

   | Verdict | Meaning | Result |
   | --- | --- | --- |
   | 예상대로 (as expected) | The prediction was right and the behavior is accepted | Accepted |
   | 잘못 알았음 (my misunderstanding) | The prediction was wrong, but the behavior is what was intended | Accepted; the PR says the prediction was wrong |
   | 답함 (answered) | A `fork` question answered | Accepted; the answer goes into the PR |
   | 되돌림 (revert) | The behavior is wrong | Work goes back |
   | 분리 (split) | The behavior is right but belongs in another PR | Work goes back |

   A wrong numeric prediction cannot be judged "as expected". Reverts and splits need a reason. You may reword a behavior description, but not the numbers and quoted values in it.
4. **Spec choices.**
   - When a reverted or split question cites spec lines, also choose what the spec becomes: spec이 틀렸다 (the spec is wrong: the agent fixes or removes the lines and leaves "거절: <reason>"), 미룬다 (deferred: the agent marks the lines "보류: <follow-up>"), or spec은 스냅샷 (snapshot: the spec stays, and the PR says the part is not implemented).
   - When everything is accepted and the handoff has a spec, choose its lifetime after merge: 삭제 (delete, the default; it stays in git history and the PR), 보관 (archive to `docs/specs/archive/`), or 유지 (keep, with an owner named in the PR). The project default is `spec.afterMerge`.
5. **Records.** For an answered `fork` question that carries a decision proposal, choose "이 PR에서만" (this PR only, the default) or "저장소에 계속 유지" (keep in the repository). Confirm or drop each decision the agent found in a PR or issue discussion.
6. **Save.** The judgment is signed with your key together with the judged commit and the hashes of the probe outputs it rests on.

Any revert or split ends in **되돌림** (returned): no PR is opened, and the agent gets your reasons and spec choices. If its session is still waiting it starts fixing right away; otherwise the next session start lists the returned task. When it hands off again, Heirloom refuses the draft while lines you called wrong or deferred are still there word for word.

The judgment can come hours later. In Claude Code, the agent waits in the background for up to 60 minutes after the handoff (in other hosts, when the host can run a command in the background): if you judge while the session is open, it continues right away. Otherwise the next session picks it up.

## 3. PR, status, records

The agent does this with the `apply-approval` skill, as soon as you accept everything if its session is still waiting, otherwise when you ask it to "apply the approved handoff".

1. **Check the judgment.** Verify the signature, and that the working tree still holds the judged code. Markdown changes do not count; any other change stops here as `stale` (see [Changes after the judgment](#changes-after-the-judgment)).
2. **Spec lifetime.** Delete the spec with `git rm` or move it with `git mv`, as you chose. A spec with uncommitted changes is left alone until it is committed; a spec that is not Markdown is never moved or deleted.
3. **Decision records.** Write the records you kept to `.heirloom/decisions/`, and remove the records they replace or that you retired.
4. **Commit and open the PR.** Commit, push, and open the PR with `gh` (GitHub) or the merge request through Heirloom's `open-mr.mjs`, which calls `glab` (GitLab). The body is the project's template (or the agent's short description) plus the "사람이 확인한 동작" (behavior a human confirmed) paragraph, which only Heirloom writes, from the signed judgment: the behavior descriptions, each prediction and verdict (wrong ones included), `fork` answers, confirmed discussions, claims without run evidence, and the spec choices. When the branch already has a PR, only that paragraph is replaced.
5. **Commit status.** Post `heirloom/understood: success` on the commit that holds exactly the judged code. Making it a merge requirement is your choice; see the README.

If no PR can be opened (the remote is neither github.com nor GitLab, or `gh`/`glab` is missing or not logged in), the work is committed and you open the PR or merge the branch yourself. Once the branch is on the target branch, the task counts as finished.

If the PR or MR is closed without merge, the task expires and its records never become active. Heirloom notices this through `gh` or `glab` when the agent applies the task again or when the dashboard overview is shown. Without the tool, or offline, the task keeps waiting.

### Decision records

Most answers belong in the PR alone; a record every few PRs at most is normal. A record comes in only two ways:

- **A `fork` answer you keep.** The agent attaches a proposal to the question: the code paths the decision covers (`scope`), where the code holds it now (`anchors`: a name in a file, and at least one test that locks it and passed on head in the probe run), and the record it `replaces`, if any.
- **A decision settled in a discussion.** A PR review comment or issue comment that settled a choice with no trace in code, tests or commits. The agent cites the comment URL and an exact quote; Heirloom fetches the comment with `gh` or `glab`, checks that it belongs to this repository and contains the quote, and keeps its author. You confirm it.

Records are never edited in place. A new record replaces an old one; a record that no longer holds is retired by a `fork` question that asks about it, and is removed in that PR. Records cover code and tests, never specs, so an outdated spec does not make a record outdated.

## Changes after the judgment

When the code changes after you judged, for example to address review comments, you do not judge everything again.

1. **Detection.** Applying stops with `stale` ("재확인 필요"). After a PR exists, a new commit has no `heirloom/understood` status, the session start says the judgment was made on an older commit, and the stop hook reminds the agent once per state.
2. **Recheck.** The agent runs `prepare-handoff` again and the same probes on the new head. If the PR is open, it first marks the PR paragraph "재확인 중" (rechecking).
   - A question asked the same way whose probe outputs (and test results) are unchanged keeps its verdict and is not asked again.
   - Questions whose outputs changed are asked again, so a fix that also changed other behavior is caught.
   - Changed code files that no behavior description points at are reported, and the agent adds probes for them.
3. **Judge.** You judge only the open questions. The new judgment points at the previous one and marks the kept verdicts.
4. **PR.** The paragraph is rebuilt from the new judgment and the status goes on the new commit.

## 4. Recall in later work

The agent does this.

- **At session start.** The agent receives two rules (do not overturn an existing decision on its own; a spec is the intent at the time it was written, and `docs/specs/archive/` is past record) and the list of paths that decision records cover. Record text is not included.
- **Once the task is known.** Before changing a file under a covered path, the agent runs the `recall-context` skill with the files it is about to change. Each record comes with its anchors checked:

  | Anchor check | Meaning | What the agent does |
  | --- | --- | --- |
  | `active` | Every anchor file and name is there; the locking test exists and did not fail on its last recorded probe run | Follows it as a rule |
  | `possibly-stale` | An anchor is gone, or its test failed on the last run | Neither follows nor ignores it; asks you, and may raise a `fork` question that retires it |

  Only presence is checked, not meaning: a function that keeps its name but changes its behavior is caught only when the locking test fails. A test's "last run" is the newest probe run of this repository that ran it; with none, only presence is checked.
- **Limits.** Recall returns at most `recall.maxRecords` records within `recall.maxTokens` tokens ([Configuration](configuration.md#project-settings)). Records left out are listed by ID.

### When a record is active

| State | Meaning | Served as a rule |
| --- | --- | --- |
| Active | The record file is merged into the target branch | Yes |
| Pending merge | Written on the task branch, not merged yet | Only to that task. Other tasks see it, and records it retires, as a warning. |
| Unknown | The target branch cannot be resolved | The worktree's records are used and marked unconfirmed |

- **No fetch.** Recall compares with the local remote-tracking branch (for example `origin/main`) and never fetches. It reports when the repository was last fetched.
- **Records from before 0.4.** Decisions and axioms of the old format are not rules. Recall names them under `legacy` with their file, for background only. See the README for how to carry one forward.
