---
name: apply-approval
description: "Use when a handoff has been approved in the Heirloom dashboard, or when pending approvals are reported at session start. Verifies the signed approval, writes the approved records, and opens the pull request (GitHub) or merge request (GitLab)."
---

# Apply Approval

A human approved a handoff in the Heirloom dashboard. This skill checks that approval, writes the approved decision and axiom records into the repository, and opens the pull request with the approved summary.

"PR" below means a GitHub pull request (`gh`) or a GitLab merge request (`glab`). `pr.provider` tells which one.

Run it in these cases only:

- the user asks you to,
- the approval wait you started for this handoff (`prepare-handoff` step 4) reports `approved`,
- the session start lists an approved handoff and the user agrees.

Never run it on your own because a handoff "should be approved by now".

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
  - `provider`: `github` or `gitlab`, `null` for an unsupported remote. `host` and `repo` (`owner/repo`, or `group/sub/project` on GitLab) name the project.
- `previousPrUrl`: set after an incremental recheck of a task whose PR already existed. Update that PR; do not open a new one (step 4).
- `removed`: record files this task wrote in an earlier round that the new incremental approval no longer produces. They were restored to the target branch version or deleted. Commit them together with `files`.
- `commitGuides`: the project's commit message guide files.

Failures:

- `E_VERIFY` (exit 4): the approval is unsigned, forged, or the draft changed after approval. Treat the handoff as **not approved**. Do not write records or open a PR. Tell the user that they need to approve it again in the dashboard.
- `E_CONFLICT` (exit 3):
  - The code or materials changed after approval (the task is now `stale`), also after the PR was opened. Tell the user. The approval is kept. When the change is finished, run `prepare-handoff` again: it starts an incremental recheck, and only the items the change touches go back to the human.
  - Another branch is checked out. Follow the hint, or ask the user.
  - The recorded PR was closed without merge (the task is now `expired`). Its records will not become active. Tell the user. A new handoff is needed if they want to submit the work again.
- Exit 75: the script already retried once. Do not run it again. Report the failure and the hint.
  - When the message says the record files are already written (`기록 파일은 이미 씀`), the task is `applied`. Say that the records are written and only the PR step failed. Do not report the records as missing or the approval as unverified.

Never edit the written record files, and never write record files yourself.

## 3. Commit

1. Read the commit guide files and follow them.
2. Commit the files in `files` and `removed`.
3. If work changes from the handoff are still uncommitted, commit them too. Do not change their content: the human approved exactly this state.
4. Run `apply.mjs --task <taskId>` again. It must still succeed. If it now reports `E_CONFLICT`, something changed after the approval. Stop and tell the user.

## 4. Open the pull request

### When `pr.available` is false

Do not open a PR. Tell the user the reason, then stop:

| `pr.reason` | Meaning |
| --- | --- |
| `unsupported_remote` | The remote is neither github.com nor GitLab (gitlab.com, or a self-hosted host `glab` is logged in to). GitHub Enterprise is not supported. |
| `gh_missing` | `gh` is not installed. |
| `gh_unauthenticated` | `gh` is not logged in. The user can run `gh auth login`. |
| `glab_missing` | `glab` is not installed. |
| `glab_unauthenticated` | `glab` is not logged in to `pr.host`. The user can run `glab auth login --hostname <pr.host>`. |
| `detached_head` | There is no branch to open a PR from. |

The records are written and committed, so the user can open the PR by hand or merge the branch directly. When the target branch contains the approved records, the task counts as finished without a PR: it leaves the session start list and the dashboard shows it as merged. Do not run `complete.mjs` without a PR URL.

### When `pr.existing` is set

A PR for this branch already exists. Do not create another one.

- Push the new commits.
- If `previousPrUrl` is set, the human approved a new summary in an incremental recheck. Write the body as in "Otherwise", step 2, and update it with the command below. Do not ask first; the approval is the request.
- Otherwise update the PR body only if the user asks, with the same command.

  ```sh
  # GitHub (REST API: `gh pr edit` fails on some gh versions with a GraphQL error about Projects classic)
  gh api -X PATCH repos/<pr.repo>/pulls/<pr.existing.number> -F body=@<file>
  # GitLab
  node <this skill>/scripts/open-mr.mjs --task <taskId> --iid <pr.existing.iid> --body-file <file>
  ```

- Go to step 5 with `pr.existing.url`.

### Otherwise

1. **Push.** Run `git push -u <pr.remote> <pr.head>`.

2. **Body.** Write it to a temporary file outside the repository.
   - Choose the template:
     - `pr.template` is set: read that template and use it. On GitLab it is a merge request template (`.gitlab/merge_request_templates/`); among several, GitLab's default `Default.md` is chosen.
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
   # GitHub
   gh pr create --repo <pr.repo> --base <pr.base> --head <pr.head> --title "<title>" --body-file <file>
   # GitLab
   node <this skill>/scripts/open-mr.mjs --task <taskId> --title "<title>" --body-file <file>
   ```

   On GitLab, always use `open-mr.mjs`. Do not run `glab mr create` or `glab mr update` yourself: glab has no body-file option, and a body passed on the command line cannot be checked by the permission rules. The script reads the file and passes the body to glab unchanged. It prints `data.url`; `data.action` is `created`, or `found` when the MR already existed (then nothing was created).

5. **If creating fails,** run `apply.mjs --task <taskId>` again before anything else. (`open-mr.mjs` already looks for an existing MR before it creates one.)
   - If `pr.existing` is now set, the PR was created. Use its URL.
   - Otherwise report the error to the user. Do not retry in a loop.

## 5. Record the PR

```sh
node <this skill>/scripts/complete.mjs --task <taskId> --pr-url <url>
```

`<url>` is the pull request URL (`https://github.com/<owner>/<repo>/pull/<n>`) or the merge request URL (`https://<host>/<group>/<project>/-/merge_requests/<n>`).

Then tell the user:

- the PR URL,
- the record files that were added or changed,
- any items kept as drafts.

Merging and deploying are not part of this skill.
