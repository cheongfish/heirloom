# Workflow

[한국어](../ko/workflow.md)

Heirloom does not do the development work. It takes over work finished with an SDLC tool such as Superpowers, and keeps the PR summary, decisions and axioms (project rules) that a human approved.

```
1. Handoff  →  2. Dashboard approval  →  3. Records and PR  →  4. Recall in later work
   (agent)        (human)                  (agent)               (agent, in progress)
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

The approval can come hours later. The agent does not wait for it and may end its session.

## 3. Records and PR

The agent does this.

Ask the agent to "apply the approved handoff". The `apply-approval` skill then runs the steps below. If an approval is still pending when a session starts, the agent tells you first.

1. **Check the approval.** Verify the signature, and check that the current draft is the approved draft. If either check fails, the handoff is treated as not approved.
2. **Check the state.** Confirm that the approved branch and source state are unchanged. If the code changed after approval, nothing is written and a new handoff is needed.
3. **Write the records.** Write record files to `.heirloom/decisions/` and `.heirloom/axioms/`. Superseded or deprecated records are marked inactive, never deleted.
4. **Commit and open the PR.** Commit the record files and open the PR with `gh`, using the approved summary verbatim. The summary goes into the summary section of the project's PR template, or to the top of the body if there is none.
5. **If a PR already exists.** When the branch already has a PR, no second one is created.

Applying the same approval more than once writes the records only once.

## 4. Recall in later work (in progress)

At session start the agent receives a summary of the active axioms and an index of decisions. Decisions related to the current changes come first.

Not available yet:

- the `recall-context` skill, which fetches the full text of related records,
- active and pending states based on whether the records were merged into the default branch.

See the [Roadmap](roadmap.md).
