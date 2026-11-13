# Dashboard

The dashboard is a local web page where a human reviews and approves handoffs. One server per user runs on `127.0.0.1`.

## Opening it

- **Automatically.** After a handoff is submitted, the browser opens once per task. Turn this off with the user setting `dashboard.openBrowser`.
- **On request.** Ask the agent to "open the Heirloom dashboard". Add the task ID to open a specific task.
- **Address.** The default is `http://127.0.0.1:17380/`. You can change the port in [Configuration](configuration.md).
- **If no browser opens.** On WSL, Heirloom uses `wslview`, or `cmd.exe /c start` when `wslview` is missing. If nothing works, the agent tells you the address so you can paste it.

## Overview

| Section | Content |
| --- | --- |
| 승인 대기 (awaiting approval) | Handoffs waiting for a human. Always shown. |
| 맥락 정리 (context curation) | Per repository: unreviewed decisions, the last curation, and a **정리 실행** (run curation) button. "정리 권장" marks a repository that meets the [suggestion condition](curation.md#when-heirloom-suggests-it). A running curation shows "정리 진행 중" instead. |
| 반영 대기 (waiting to apply) | Approved tasks whose records are not written or whose PR is not open yet (approved, applied) |
| 인계되지 않은 변경 (unhanded changes) | Worktrees with code changes but no handoff for their current state |
| 오래된 미처리 건 (stale) | Unfinished tasks whose last activity is older than `dashboard.staleDays` (default 7). They never expire just because time passed. |
| 진행 중 (in progress) | Tasks whose draft is still being prepared |
| 최근 끝난 작업 (recently finished) | The last ten finished tasks |

Sections after 승인 대기 are shown only when they have rows; the empty ones are named on one line at the end ("비어 있는 목록: …"). Clicking a task row opens its task screen; the row turns orange on hover or keyboard focus.

When the overview is shown, tasks whose PR or MR was created are checked with `gh` or `glab` in the background, so the list never waits for the network. A PR or MR closed without merge marks its task as expired (만료됨), and open screens update. A merged one is not checked again; others are checked again after five minutes. Without `gh` or `glab` nothing changes.

## Task screen

The task screen shows the title, the state badge, the task ID and `branch → base`. It has tabs, and the approval bar stays at the bottom of every tab. The screen uses the Korean names of the record kinds: 결정 (decision) and 규칙 (axiom).

| Tab | Content |
| --- | --- |
| 개요 (overview) | Task boundary (repository, branch, reviewed source state, changed files grouped as 신규/수정/삭제 (new/modified/deleted), materials), and missing items, conflicts and warnings. Check warnings name the item, its title and the field (for example `결정 #1 '…' 연관 코드 경로: …`). A badge shows how many notices need attention. For a re-check (증분 재확인), also the approval it is based on, the files and materials changed since, and unlinked changes. |
| PR 요약 (PR summary) | One text box with one bullet per line; a leading `- `, `* `, `•` or `1.` is optional and empty lines are ignored. **초안 생성** (fill from draft) puts the agent's draft back into the box, after a confirmation if you changed it. |
| 결정 (decision) | Approve, reject or hold each item. New items show their title and filled fields; **편집** (edit) turns one card into a form, and an edited card shows "고침" (edited). **남은 결정 모두 승인** (approve the remaining decisions) asks for confirmation and approves only the items without a choice; rejects and holds stay. |
| 규칙 (axiom) | Approve, reject or hold each item. Axioms are never included in a bulk approval. |
| 승인 내용 (approval) | Shown after approval: final summary and the decision per item. The approver and the signing key stay in the signed approval file. |

- **Edits and updates.** If the agent resubmits the draft while you are editing, your input stays and a "새 초안이 있음" (new draft available) banner appears.
- **Approve button.** It is enabled only when the summary is not empty, every open item has a decision, and every held or rejected axiom candidate has a reason. While it is disabled, the bar says what is missing, and **다음 미처리 항목으로** (next open item) jumps to the first item that needs you.
- **Summary origins.** On approval, each line is matched to the draft bullet it came from: an unchanged line by its text, an edited line by its position. The next re-check uses this to keep the code paths of each bullet. If you reorder lines and also reword them, a line can be matched to the wrong draft bullet.
- **Re-check after approval.** When the code changed after an approval ([Workflow](workflow.md#changes-after-approval)), items that keep their approval are marked "승인 유지" (approval kept) and folded. Under the summary box, each draft bullet is listed as "승인 유지" or "다시 확인" (re-check) with its reasons and the approved text. Items up for re-check show why, and the approved version under "지난 승인 내용". "다시 검토" (review again) opens a kept item for a decision. Only open items need a decision; if none is open, one confirmation of the summary is enough.
- **Discard.** "작업 폐기" (discard) ends the handoff. A discarded task cannot be approved or applied.
- **Curation tasks.** A [context curation](curation.md) has the same tabs. Its overview shows the dedicated worktree, the state of the headless run (with "다시 실행" after a failure) and the batch with earlier review history. Axiom candidates list their evidence decisions and have a reason field, required to hold or reject them. Saving the approval starts the headless apply step.

## Server lifetime

- The server stops by itself after 30 minutes with no open screen and no requests. Change the time with `dashboard.idleMinutes`.
- All state is on disk, so nothing is lost when the server stops. It starts again with the next handoff or dashboard request.
- After a plugin update, the server restarts with the new code the next time it is needed.

## Port conflicts

If another program uses the port, the dashboard does not start. The handoff and its waiting state are kept.

```sh
lsof -i :17380
ss -ltnp 'sport = :17380'
```

Stop the other program, or set `dashboard.port` to another value.
