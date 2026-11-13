# Context curation

Each handoff records the decisions of one piece of work. Over time decisions repeat, overlap, or turn out to keep the same rule. A context curation reviews a batch of decisions that were never reviewed together, and proposes:

- clean-up of duplicates (supersede or deprecate),
- relations between existing records: an exception or coexistence, always with a condition,
- changes to existing axioms,
- new axiom candidates: a rule backed by two or more decisions.

Curation is optional and runs only when you choose it. Nothing changes until you approve each proposal in the dashboard, and an approved proposal becomes active only when its PR is merged.

## When Heirloom suggests it

A decision is **unreviewed** while it is active on the target branch and no merged curation has reviewed it. Heirloom suggests a curation when either holds:

- 10 or more unreviewed decisions, or
- 3 or more unreviewed decisions and 30 days since the last curation (with no curation yet, since the oldest unreviewed decision was approved).

The suggestion appears as a card in the dashboard overview (맥락 정리) and as one line at session start. It never interrupts your work with a dialog. The thresholds are [project settings](configuration.md#project-settings) (`curation.*`). The counts are read from the target branch as last fetched; nothing is fetched to compute them.

## Running a curation

1. In the dashboard overview, choose **정리 실행** (run curation) on the repository's card and confirm.
2. The dashboard server fetches the target branch, then creates a dedicated worktree under `~/.heirloom/worktrees/<repoId>/<taskId>/` on a new branch `heirloom/curate-<date>-<suffix>` started from the target branch. Your own working trees are never touched.
3. It runs a headless agent there (`claude -p` by default, or `codex exec`, `agy -p`) with the `curate-decisions` skill. The agent reads up to 20 unreviewed decisions (oldest first), the active records related to them, every active axiom and the earlier review history, then submits a draft.
4. You review the proposals on the task screen, like a handoff. Axiom candidates show their evidence decisions. **Holding or rejecting a candidate needs a reason**, which is kept in the repository.
5. When you save the approval, the dashboard runs the headless agent again with the `apply-approval` skill. It writes the records and the review history, commits them, pushes the branch and opens the PR.
6. When the PR is merged, the batch counts as reviewed and the dedicated worktree and its local branch are removed. They are also removed when the task is discarded or its PR is closed without merge. A worktree with uncommitted changes is kept, and the task screen says why.

Only one curation per repository runs at a time.

## Review history

Every approved curation writes `.heirloom/curation/c-<id>.json` next to the records, committed in the same PR. It lists the batch, each candidate with your decision (accepted, held, rejected) and reason, and the other proposed changes.

A candidate you held or rejected is not proposed again without new evidence: a draft whose candidate cites only decisions that an earlier held or rejected candidate already cited is refused by the source check.

## When a headless run fails

A run that fails, times out (30 minutes) or cannot start (the command is missing) leaves the task where it was. The task screen shows the reason, the log file and two ways on:

- **다시 실행** (run again): runs the same step again. Runs are never retried automatically.
- **By hand:** `cd` into the worktree shown on the screen, start your host there and run `curate-decisions` (before approval) or `apply-approval` (after approval): `/curate-decisions` in Claude Code and Antigravity, `$curate-decisions` in Codex.

## Limits

- The headless agent runs with your user's permissions and uses your `gh` or `glab` login. Its tools are limited per step (see [Security](security.md#headless-curation-runs)).
- Only github.com and GitLab remotes get a PR (an MR on GitLab). With another remote, the records are committed in the curation worktree; push and merge the branch yourself.
- The host is the one of the repository's last session (Claude Code, Codex or Antigravity; Cursor sessions are not counted), recorded when a session starts; the dashboard shows it before you run. Without a recorded session it is `curation.agent.host` ([Configuration](configuration.md#user-settings)). The configured `command` and `model` apply when the host is the configured one; another host runs its default command (`claude`, `codex`, `agy`).
- Antigravity: a run that needs a command outside its allowed list stops without output; the dashboard shows it as failed with `permission_denied`. Run it again, or run the step by hand.
- Codex: the drafting step runs in Codex's sandbox, where the dashboard cannot be reached; the draft is still submitted and the dashboard screen updates.
