---
name: apply-approval
description: "Use when the user requests applying an approved handoff, or this session's approval wait reports approval."
---

# Apply Approval

Verify the dashboard judgment, write the decision records the person kept and open the PR. Here PR means GitHub pull request (`gh`) or GitLab merge request (`glab`), selected by `pr.provider`.

Run only on the user's request/agreement, or when this session's wait (`prepare-handoff` step 5) reports `approved`. Session-start notice alone or assumed approval is insufficient.

## 1. Find the approval

```sh
node <this skill>/scripts/apply.mjs
```

Without `--task`, lists this worktree's approved unfinished handoffs in `data.pending`. If several exist and the user did not choose, ask.

## 2. Apply it

```sh
node <this skill>/scripts/apply.mjs --task <taskId>
```

Success `data` is a judgment (`kind: "judgment"`): `files` are the decision records the person kept (`.heirloom/decisions/d-….md`) and `removed` the records they replace or retire, its PR paragraph comes from `pr-body.mjs` (step 4), and `status` is the commit the `heirloom/understood` status will go on (`sha`), or why there is none yet (`reason`: `uncommitted` means commit the judged work first).

| Field | Meaning |
| --- | --- |
| `files` | Written repository-relative files: decision records and the spec lifetime's archive path; `alreadyApplied: true` means no repeat writes. |
| `removed` | Records replaced or retired, prior-round records restored to the target version or deleted, and a deleted or moved spec; commit with `files`. |
| `pr` | Step 4 inputs; null when already recorded (`prUrl`). `provider` is `github`, `gitlab` or null; `host`/`repo` identify the project (`owner/repo` or GitLab `group/sub/project`). |
| `previousPrUrl` | Existing PR after a recheck; update it rather than creating another. |
| `commitGuides` | Project commit guide files. |
| `spec` | The spec lifetime the person chose (`action` `delete`, `archive` or `keep`, with `owner` for `keep`), carried out in the working tree by this script; null when the handoff had no spec. `specs[].status`: `deleted`/`archived` (staged by `git rm`/`git mv`; `to` is the archive path), `kept`, `not_markdown` (left alone), `missing`, `uncommitted` (the spec has changes not committed yet; nothing was done), `archive_taken` (a file already sits at `to`; report it). `pending: true` means a spec still waits. |

Failures:

- `E_VERIFY` (exit 4): unsigned/forged judgment, changed draft, or an item approval from before the pivot (`이전 형식`). Treat as unapproved; write no records, open no PR. Request a new judgment in the dashboard; for the old format, rerun `prepare-handoff` to hand off again.
- `E_CONFLICT` (3):
  - `stale`: code changed after the judgment, even if a PR exists. Report; the judgment is retained. Once changes finish, rerun `prepare-handoff` for a recheck.
  - Wrong branch: follow the hint or ask.
  - `expired`: PR closed unmerged; records will not activate. Report; resubmission needs a new handoff.
- Exit 75: already retried; report error/hint without rerunning. If the message says `기록 파일은 이미 씀`, state is `applied`: report records written, only PR step failed, not missing records or unverified approval.

Never write or edit record files yourself.

## 3. Commit

Follow `commitGuides`. Commit `files`, `removed`, and any uncommitted handoff work without changing judged content. Rerun `apply.mjs --task <taskId>`; require success. On `E_CONFLICT`, stop and report post-judgment changes. Require `status.sha` to be set before you push.

With `spec`: commit the handoff work first. If a spec was `uncommitted`, the rerun carries out the lifetime; commit that spec change on its own (it is Markdown only and does not invalidate the judgment), then rerun once more. Push only when `spec.pending` is false, or report `archive_taken` to the user. Never move, delete or edit the spec yourself for this step.

## 4. Open the pull request

### When `pr.available` is false

Report the reason and stop; do not open a PR:

| `pr.reason` | Meaning |
| --- | --- |
| `unsupported_remote` | Supports github.com and GitLab (gitlab.com or self-hosted with authenticated `glab`); no GitHub Enterprise. |
| `gh_missing`, `glab_missing` | Required CLI is absent. |
| `gh_unauthenticated` | User needs `gh auth login`. |
| `glab_unauthenticated` | User needs `glab auth login --hostname <pr.host>`. |
| `detached_head` | No branch for a PR. |

The work is committed; the user can open a PR manually or merge directly. Once the task branch reaches the target branch, the task completes, leaves session-start listings and appears merged in the dashboard. Never run `complete.mjs` without a PR URL.

### When `pr.existing` is set

Push new commits; never create a duplicate PR. If `previousPrUrl` is set, update the body; the new judgment authorizes this without another question. Fetch the current body into a file (`gh pr view <url> --json body -q .body`, or `glab api` for the MR), run `pr-body.mjs` on it (it replaces only its own paragraph), then update. Otherwise update the body only on user request.

```sh
# GitHub: REST avoids gh pr edit's Projects classic GraphQL failure on some versions.
gh api -X PATCH repos/<pr.repo>/pulls/<pr.existing.number> -F body=@<file>
# GitLab
node <this skill>/scripts/open-mr.mjs --task <taskId> --iid <pr.existing.iid> --body-file <file>
```

Continue to step 5 with `pr.existing.url`.

### Otherwise

1. **Push:** `git push -u <pr.remote> <pr.head>`.

2. **Body:** write a temporary file outside the repository.
   - Read/use `pr.template` when set (GitLab selects `Default.md` among templates). If multiple `pr.templates` exist without a selected template, ask the user. If both are empty, use no template.
   - Fill template sections only with known facts; otherwise preserve them.
   - Write the rest of the body (template, a short description of the change in your words, without observed values), then add the paragraph. Never write or edit the paragraph yourself:

     ```sh
     node <this skill>/scripts/pr-body.mjs --task <taskId> --body-file <file>
     ```

3. **Title:** follow project rules from the template, `CONTRIBUTING.md` or referenced PR guide. Otherwise use one line of at most 72 characters in the handoff's language describing the change. Never present the title as approved.

4. **Create:**

   ```sh
   # GitHub
   gh pr create --repo <pr.repo> --base <pr.base> --head <pr.head> --title "<title>" --body-file <file>
   # GitLab
   node <this skill>/scripts/open-mr.mjs --task <taskId> --title "<title>" --body-file <file>
   ```

   Always use `open-mr.mjs` for GitLab creation/updates, never direct `glab mr create/update`: command-line bodies bypass body-file permission checks. The script passes file content unchanged, returns `data.url`, and reports `data.action` as `created` or `found` (already existed).

5. **Creation failure:** before anything else, rerun `apply.mjs --task <taskId>`. If `pr.existing` now exists, use its URL; otherwise report the error without a retry loop. `open-mr.mjs` also checks for an existing MR before creation.

## 5. Record the PR

```sh
node <this skill>/scripts/complete.mjs --task <taskId> --pr-url <url>
```

Use `https://github.com/<owner>/<repo>/pull/<n>` or `https://<host>/<group>/<project>/-/merge_requests/<n>`.

This also sets the `heirloom/understood` commit status on the judged commit (`data.status`). If `status.posted` is false, report `status.error`; running `complete.mjs` again retries it. A commit pushed later has no status, which shows on the PR that the judgment does not cover it.

Report the PR URL and the added or removed decision record files. Merging and deploying are outside this skill.
