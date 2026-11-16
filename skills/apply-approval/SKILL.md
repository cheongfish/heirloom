---
name: apply-approval
description: "Use when the user requests applying an approved handoff, or this session's approval wait reports approval."
---

# Apply Approval

Verify dashboard approval, write approved records and open the PR. Here PR means GitHub pull request (`gh`) or GitLab merge request (`glab`), selected by `pr.provider`.

Run only on the user's request/agreement, or when this session's wait (`prepare-handoff` step 4) reports `approved`. Session-start notice alone or assumed approval is insufficient.

## 1. Find the approval

```sh
node <this skill>/scripts/apply.mjs
```

Without `--task`, lists this worktree's approved unfinished handoffs in `data.pending`. If several exist and the user did not choose, ask.

## 2. Apply it

```sh
node <this skill>/scripts/apply.mjs --task <taskId>
```

Success `data`:

| Field | Meaning |
| --- | --- |
| `files` | Written repository-relative `.heirloom/` records; `alreadyApplied: true` means no repeat writes. |
| `summary`, `records` | Approved PR bullets and record changes; `pendingItems` remain drafts. |
| `removed` | Prior-round records restored to the target version or deleted by incremental approval; commit with `files`. |
| `pr` | Step 4 inputs; null when already recorded (`prUrl`). `provider` is `github`, `gitlab` or null; `host`/`repo` identify the project (`owner/repo` or GitLab `group/sub/project`). |
| `previousPrUrl` | Existing PR after incremental recheck; update it rather than creating another. |
| `commitGuides` | Project commit guide files. |

Failures:

- `E_VERIFY` (exit 4): unsigned/forged approval or changed draft. Treat as unapproved; write no records, open no PR, and request dashboard reapproval.
- `E_CONFLICT` (3):
  - `stale`: code/materials changed after approval, even if a PR exists. Report; approval is retained. Once changes finish, rerun `prepare-handoff` for affected-item recheck.
  - Wrong branch: follow the hint or ask.
  - `expired`: PR closed unmerged; records will not activate. Report; resubmission needs a new handoff.
- Exit 75: already retried; report error/hint without rerunning. If the message says `기록 파일은 이미 씀`, state is `applied`: report records written, only PR step failed, not missing records or unverified approval.

Never write or edit record files yourself.

## 3. Commit

Follow `commitGuides`. Commit `files`, `removed`, and any uncommitted handoff work without changing approved content. Rerun `apply.mjs --task <taskId>`; require success. On `E_CONFLICT`, stop and report post-approval changes.

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

Records are committed; the user can open a PR manually or merge directly. Once approved records reach the target branch, the task completes, leaves session-start listings and appears merged in the dashboard. Never run `complete.mjs` without a PR URL.

### When `pr.existing` is set

Push new commits; never create a duplicate PR. If `previousPrUrl` is set, update the body using "Otherwise", step 2; incremental approval authorizes this without another question. Otherwise update the body only on user request.

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
   - Copy approved `summary` bullets verbatim and in order. Never reword, merge, translate or extend them. Put them in the template's summary section, or at the top if there is none.
   - Fill other template sections only with known facts; otherwise preserve them.
   - After the summary list `records` by id/title and `pendingItems` as "kept as drafts".

3. **Title:** follow project rules from the template, `CONTRIBUTING.md` or referenced PR guide. Otherwise use one line of at most 72 characters in the summary's language describing the change. Never present the title as approved.

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

Report the PR URL, added/changed record files and items kept as drafts. Merging and deploying are outside this skill.
