# Workflow

[한국어](../ko/workflow.md)

Heirloom does not do the development work. It takes over work finished with an SDLC tool such as Superpowers, and keeps the PR summary, decisions and axioms (project rules) that a human approved.

```
1. Handoff  →  2. Dashboard approval  →  3. Records and PR  →  4. Recall in later work
   (agent)        (human)                  (agent)               (agent)
```

## 1. Handoff

The agent does this.

- **When.** After finishing the implementation and final review of a spec-based task, and before reporting completion, the agent runs the `prepare-handoff` skill.
- **If the agent forgets.** The stop hook reminds it once. Three conditions must hold: there are code changes linked to a spec, no handoff exists for that state, and no reminder was given for the same state.
- **Work without a spec.** A small fix, for example, is handed off only when the user asks.
- **Steps.**
  1. Heirloom freezes the current source state and the materials (spec, review documents).
  2. The agent writes the PR summary and the decision and axiom drafts.
  3. Heirloom checks the drafts' source quotes mechanically. If a quote is not in the source, the draft is not shown for approval.
- **Result.** When the check passes, the dashboard opens, once per task. A readable handoff file (`handoff.md`) is also written.

A handoff only means the agent reports the work is ready. It is not proof that the work is correct, and it is not an approval.

## 2. Dashboard approval

A human does this. See [Dashboard](dashboard.md) for the screens.

1. Review the PR summary and edit it if needed.
2. Choose approve, reject or hold for each decision.
3. Choose separately for each axiom, because axioms apply to all later work.
4. Press "승인 저장" (save approval). The approval is signed with your key and saved.

A task without decision or axiom changes ends with a **quick approval**: one confirmation of the summary. Opening or closing the screen is never taken as approval.

The approval can come hours later. The agent does not hold its session open for it. In Claude Code, it waits in the background for up to 60 minutes after the handoff: if you approve while the session is still open, it applies the approval right away (section 3) without being asked. Otherwise it may end its session, and the next session picks the approval up.

## 3. Records and PR

The agent does this.

If the session that made the handoff is still waiting, it starts this as soon as you approve. Otherwise ask the agent to "apply the approved handoff". The `apply-approval` skill then runs the steps below. If an approval is still pending when a session starts, the agent tells you first and waits for your request.

1. **Check the approval.** Verify the signature, and check that the current draft is the approved draft. If either check fails, the handoff is treated as not approved.
2. **Check the state.** Confirm that the approved branch and source state are unchanged. If the code changed after approval, nothing is written and a new handoff is needed.
3. **Write the records.** Write record files to `.heirloom/decisions/` and `.heirloom/axioms/`. Superseded or deprecated records are marked inactive, never deleted.
4. **Commit and open the PR.** Commit the record files and open the PR with `gh`, using the approved summary verbatim. The summary goes into the summary section of the project's PR template, or to the top of the body if there is none.
5. **If a PR already exists.** When the branch already has a PR, no second one is created.

Applying the same approval more than once writes the records only once.

If no PR can be opened (the remote is not on github.com, `gh` is missing or not logged in), the records are written and committed, and you open the PR or merge the branch yourself. Once the approved records are on the target branch, the task counts as finished: it leaves the session start list, and the dashboard shows it as merged.

If the PR is closed without merge, the task expires and its records never become active. Heirloom notices this through `gh` when the agent applies the task again or when the dashboard overview is shown. Without `gh`, or offline, the task keeps waiting.

## 4. Recall in later work

The agent does this.

- **At session start.** The agent receives a summary of the active axioms and an index of active decisions. Decisions related to the current changes come first.
- **Once the task is known.** The agent runs the `recall-context` skill to fetch the full text of the records related to the files, topics or record IDs it is working on. Each result says why it matched. A path match is a hint; the agent still reads the record's scope.
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
