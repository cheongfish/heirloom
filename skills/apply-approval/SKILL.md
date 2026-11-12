---
name: apply-approval
description: "Use when a handoff has been approved in the Heirloom dashboard, or when pending approvals are reported at session start. Verifies the signed approval, writes the approved records, and opens the pull request."
---

# Apply Approval

A human approved a handoff in the Heirloom dashboard. This skill checks that approval, writes the approved decision and axiom records into the repository, and opens the pull request with the approved summary.

Run it when the user asks you to, or when the session start lists an approved handoff and the user agrees. Never run it on your own because a handoff "should be approved by now".

## 1. Find the approval

```sh
node <this skill>/scripts/apply.mjs
```

Without `--task` the script lists the approved but unfinished handoffs of this worktree (`data.pending`). If there is more than one and the user did not say which, ask. Do not pick one.

## 2. Apply it

```sh
node <this skill>/scripts/apply.mjs --task <taskId>
```

On success, `data` contains:

- `files`: the record files written under `.heirloom/` (repository-relative). `alreadyApplied: true` means an earlier run wrote them, and nothing was written again.
- `summary`: the PR summary bullets the human approved.
- `records`: the approved record changes. `pendingItems` are items the human put on hold. They stay drafts.
- `pr`: what you need for the pull request (step 4). `null` when the PR is already recorded (`prUrl`).
- `commitGuides`: the project's commit message guide files.

Failures:

- `E_VERIFY` (exit 4): the approval is unsigned, forged, or the draft changed after approval. Treat the handoff as **not approved**. Do not write records or open a PR. Tell the user that they need to approve it again in the dashboard.
- `E_CONFLICT` (exit 3):
  - The code changed after approval (the task is now `stale`). Tell the user. A new handoff is needed (`prepare-handoff`). The old approval is kept.
  - Another branch is checked out. Follow the hint, or ask the user.
  - The recorded PR was closed without merge (the task is now `expired`). Its records will not become active. Tell the user. A new handoff is needed if they want to submit the work again.
- Exit 75: the script already retried once. Do not run it again. Report the failure and the hint.

Never edit the written record files, and never write record files yourself.

## 3. Commit

1. Read the commit guide files and follow them.
2. Commit the files in `files`.
3. If work changes from the handoff are still uncommitted, commit them too. Do not change their content: the human approved exactly this state.
4. Run `apply.mjs --task <taskId>` again. It must still succeed. If it now reports `E_CONFLICT`, something changed after the approval. Stop and tell the user.

## 4. Open the pull request

### When `pr.available` is false

Do not open a PR. Tell the user the reason, then stop:

| `pr.reason` | Meaning |
| --- | --- |
| `not_github` | The remote is not on github.com. The MVP opens PRs only with `gh` on GitHub. |
| `gh_missing` | `gh` is not installed. |
| `gh_unauthenticated` | `gh` is not logged in. The user can run `gh auth login`. |
| `detached_head` | There is no branch to open a PR from. |

The records are written and committed, so the user can open the PR by hand.

### When `pr.existing` is set

A PR for this branch already exists. Do not create another one.

- Push the new commits.
- Update the PR body only if the user asks (`gh pr edit <number> --body-file <file>`).
- Go to step 5 with `pr.existing.url`.

### Otherwise

1. **Push.** Run `git push -u <pr.remote> <pr.head>`.

2. **Body.** Write it to a temporary file outside the repository.
   - Choose the template:
     - `pr.template` is set: read that template and use it.
     - `pr.templates` lists several templates and `pr.template` is null: ask the user which one to use. Do not choose.
     - Both are empty: the project has no template.
   - Put the `summary` bullets **verbatim**, in order, as a bulleted list. Do not reword, merge, translate or extend them. The human approved these exact sentences.
     - With a template, put the summary into its summary section (for example "Summary", "요약", "개요", "Description").
     - When the template has no such section, or there is no template, put the summary at the very top of the body.
   - Fill the template's other sections only with facts you know. Leave the rest as the template has them.
   - After the summary, list the approved record changes from `records` (id and title). Mention `pendingItems` as "kept as drafts".

3. **Title.**
   - If the project defines a PR title rule, follow it and ignore the default below. Look in the PR template, `CONTRIBUTING.md`, or a PR guide the project points to.
   - Otherwise write one line of at most 72 characters, in the language of the summary, that names the overall change.
   - The title is not part of the approval. Do not present it as approved.

4. **Create.**

   ```sh
   gh pr create --repo <pr.repo> --base <pr.base> --head <pr.head> --title "<title>" --body-file <file>
   ```

5. **If `gh pr create` fails,** run `apply.mjs --task <taskId>` again before anything else.
   - If `pr.existing` is now set, the PR was created. Use its URL.
   - Otherwise report the error to the user. Do not retry in a loop.

## 5. Record the PR

```sh
node <this skill>/scripts/complete.mjs --task <taskId> --pr-url <url>
```

Then tell the user:

- the PR URL,
- the record files that were added or changed,
- any items kept as drafts.

Merging and deploying are not part of this skill.
