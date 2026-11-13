# Workflow

Heirloom does not do the development work. It takes over work finished with an SDLC tool such as Superpowers, and keeps the PR summary, decisions and axioms (project rules) that a human approved.

```
1. Handoff  →  2. Dashboard approval  →  3. Records and PR  →  4. Recall in later work
   (agent)        (human)                  (agent)               (agent)
```

## 1. Handoff

The agent does this.

- **When.** After finishing the implementation and final review of a spec-based task, and before reporting completion, the agent runs the `prepare-handoff` skill.
- **If the agent forgets.** The stop hook reminds it once. Three conditions must hold: there are code changes linked to a spec, no handoff exists for that state, and no reminder was given for the same state. A spec counts as linked when this branch changed it, and also when the session read a spec that was already on the target branch (checked in the session transcript; how each host records reads is in [Hosts](hosts.md#differences)).
- **If specs live elsewhere.** When the handed-off spec does not match the spec location setting (`specGlobs`), the agent asks after the handoff whether to add a matching pattern to `.heirloom/config.json`. Only if you agree does it create the file or add the pattern. The file is a project file; commit it.
- **Work without a spec.** A small fix, a refactor or work asked for in the chat is handed off only when the user asks (`prepare-handoff --manual`). So that a chat-only user learns this, the stop hook tells the agent once per session when there are code changes without a linked spec, and the agent mentions it in one sentence when it reports the work as finished.
- **Decisions made in the chat.** A decision the user typed in the session can be recorded, quoting the user's message as its source. The agent's own replies, tool output and text the host adds as the user (environment details, hook messages, slash commands) are never a source.
- **Steps.**
  1. Heirloom freezes the current source state and the materials (spec, review documents), and the messages the user typed in the session.
  2. The agent writes the PR summary and the decision and axiom drafts.
  3. Heirloom checks the drafts' source quotes mechanically. A quote must be in its document, or in one of the user's messages. If it is not, the draft is not shown for approval.
- **Result.** When the check passes, the dashboard opens, once per task. A readable handoff file (`handoff.md`) is also written.

Which session's messages are frozen: the session start and stop hooks record each session's transcript per worktree, and a handoff takes the session that was active last. When another session of the same worktree ran at the same time within the last two hours, Heirloom does not guess: the handoff goes ahead without the conversation, and decisions need a document source. A quoted message is written into the record file in the repository once approved, so check quotes in the dashboard as you would check a document quote.

A handoff only means the agent reports the work is ready. It is not proof that the work is correct, and it is not an approval.

## 2. Dashboard approval

A human does this. See [Dashboard](dashboard.md) for the screens.

1. Review the PR summary and edit it if needed.
2. Choose approve, reject or hold for each decision.
3. Choose separately for each axiom, because axioms apply to all later work.
4. Press "승인 저장" (save approval). The approval is signed with your key and saved.

A task without decision or axiom changes ends with a **quick approval**: one confirmation of the summary. Opening or closing the screen is never taken as approval.

The approval can come hours later. The agent does not hold its session open for it. In Claude Code, it waits in the background for up to 60 minutes after the handoff (in other hosts, when the host can run a command in the background): if you approve while the session is still open, it applies the approval right away (section 3) without being asked. Otherwise it may end its session, and the next session picks the approval up.

## 3. Records and PR

The agent does this.

If the session that made the handoff is still waiting, it starts this as soon as you approve. Otherwise ask the agent to "apply the approved handoff". The `apply-approval` skill then runs the steps below. If an approval is still pending when a session starts, the agent tells you first and waits for your request.

1. **Check the approval.** Verify the signature, and check that the current draft is the approved draft. If either check fails, the handoff is treated as not approved.
2. **Check the state.** Confirm that the approved branch and source state are unchanged. If the code changed after approval, nothing is written and the task needs a re-check (see [Changes after approval](#changes-after-approval)). A rebase that leaves the task's own files unchanged does not count as a change.
3. **Write the records.** Write record files to `.heirloom/decisions/` and `.heirloom/axioms/`. Superseded or deprecated records are marked inactive, never deleted.
4. **Commit and open the PR.** Commit the record files and open the PR with `gh` (GitHub) or the merge request through Heirloom's `open-mr.mjs`, which calls `glab` (GitLab), using the approved summary verbatim. The summary goes into the summary section of the project's template, or to the top of the body if there is none. On GitLab the templates are `.gitlab/merge_request_templates/*.md`; when there are several, `Default.md` is used, and without it the agent asks you which one.
5. **If a PR already exists.** When the branch already has a PR, no second one is created.

Applying the same approval more than once writes the records only once.

If no PR can be opened (the remote is neither github.com nor GitLab, or `gh`/`glab` is missing or not logged in), the records are written and committed, and you open the PR or merge the branch yourself. Once the approved records are on the target branch, the task counts as finished: it leaves the session start list, and the dashboard shows it as merged.

If the PR or MR is closed without merge, the task expires and its records never become active. Heirloom notices this through `gh` or `glab` when the agent applies the task again or when the dashboard overview is shown. Without the tool, or offline, the task keeps waiting.

## Changes after approval

When the code or the materials (spec, review documents) change after you approved, for example to address review comments, you do not approve everything again. Only the approved items the change touches come back to you. This works before the records are written, after, and after the PR is open.

1. **Detection.** Applying the approval stops, and the task shows as "재확인 필요" (re-check needed). When the agent is about to stop with such changes, the stop hook reminds it once per state.
2. **Re-check handoff.** The agent runs `prepare-handoff` again. Heirloom compares the current state with the signed approval:
   - A summary bullet or record is up for re-check when a changed file matches its code paths, or when a material it quotes changed. A supersede follows its replacement record. Items you put on hold come back too.
   - A changed file that matches no item is an **unlinked change**. Heirloom cannot tell what it affects, so the whole summary comes back.
   - After a rebase or merge of the target branch, only the files the task itself changed are compared. Changes from the target branch are not checked. A task file whose content differs is marked "기준 브랜치 갱신으로 인한 변경" (changed by a target branch update) when the target branch also changed it, and "수정" (edited) otherwise.
   - The agent rewrites only the items up for re-check. It may add items it thinks are touched, with a reason, but it cannot remove any. Heirloom refuses a draft that changes an item that keeps its approval.
3. **Approval.** The dashboard shows the reasons and the approved version next to each item up for re-check. Items that keep their approval are folded; open one with "다시 검토" (review again) if you think the change does touch it. You decide only the open items.
4. **Records and PR.** The new approval contains the combined result. Record files this task wrote earlier are rewritten in place; a record you now reject is taken out again. If the PR already exists, the agent updates its body with the approved summary instead of opening a new one.

If the code changes again while you review, saving is refused and the next round starts from the same signed approval. A re-check is not a second review of the implementation: it only checks that the approved description and decisions still fit the code.

## Curating decisions over time

Decisions from many handoffs can be reviewed together in a [context curation](curation.md): duplicates cleaned up, relations added, and rules worth keeping proposed as axiom candidates. Heirloom suggests it in the dashboard when enough decisions are unreviewed; it runs only when you choose it.

## 4. Recall in later work

The agent does this.

- **At session start.** The agent receives a summary of the active axioms and an index of active decisions. Decisions related to the current changes come first.
- **Once the task is known.** The agent runs the `recall-context` skill to fetch the full text of the records related to the files, topics or record IDs it is working on. Each result says why it matched. A path match is a hint; the agent still reads the record's scope. It passes the files it is about to change, so recall works before anything has changed; with no query and no changed code files, recall fails with exit 2 instead of returning an empty result.
- **Limits.** Recall returns at most `recall.maxRecords` records within `recall.maxTokens` tokens ([Configuration](configuration.md#project-settings)). Records left out are listed by ID so the agent can ask for them.

### When a record is active

| State | Meaning | Served as a rule |
| --- | --- | --- |
| Active | The record file is merged into the target branch | Yes |
| Pending merge | Approved and written on the task branch, not merged yet | Only to the task that approved it. Other tasks see its ID and title as a warning. |
| Inactive | Its supersede or deprecation is merged | No. Kept as history. |
| Unknown | The target branch cannot be resolved | The worktree's records are used and marked unconfirmed |

- **No fetch.** Session start and recall compare with the local remote-tracking branch (for example `origin/main`) and never fetch. They report when the repository was last fetched, so a merge after that is not seen until the next fetch. Applying an approval fetches the target branch.
- **Parallel work.** A supersede or deprecation approved in another worktree of the same repository is shown as a warning until it is merged.
- **Edits during PR review.** The merged wording is what counts.
