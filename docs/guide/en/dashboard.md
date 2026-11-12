# Dashboard

[한국어](../ko/dashboard.md)

The dashboard is a local web page where a human reviews and approves handoffs. One server per user runs on `127.0.0.1`.

## Opening it

- **Automatically.** After a handoff is submitted, the browser opens once per task. Turn this off with the user setting `dashboard.openBrowser`.
- **On request.** Ask the agent to "open the Heirloom dashboard". Add the task ID to open a specific task.
- **Address.** The default is `http://127.0.0.1:17380/`. You can change the port in [Configuration](configuration.md).
- **If no browser opens.** On WSL, Heirloom uses `wslview`, or `cmd.exe /c start` when `wslview` is missing. If nothing works, the agent tells you the address so you can paste it.

## Overview

| Section | Content |
| --- | --- |
| 승인 대기 (awaiting approval) | Handoffs waiting for a human |
| 맥락 정리 (context curation) | Per repository: unreviewed decisions, the last curation, and a **정리 실행** (run curation) button. "정리 권장" marks a repository that meets the [suggestion condition](curation.md#when-heirloom-suggests-it). A running curation shows "정리 진행 중" instead. |
| 인계되지 않은 변경 (unhanded changes) | Worktrees with code changes but no handoff for their current state |
| 오래된 미처리 건 (stale) | Unfinished tasks whose last activity is older than `dashboard.staleDays` (default 7). They never expire just because time passed. |
| 진행 중, 최근 끝난 작업 (in progress, recently finished) | All other tasks |

When the overview is shown, tasks whose PR or MR was created are checked with `gh` or `glab` in the background, so the list never waits for the network. A PR or MR closed without merge marks its task as expired (만료됨), and open screens update. A merged one is not checked again; others are checked again after five minutes. Without `gh` or `glab` nothing changes.

## Task screen

The task screen has tabs. The approval bar stays at the bottom of every tab.

| Tab | Content |
| --- | --- |
| 개요 (overview) | Task boundary (repository, branch, reviewed source state, changed files, materials), and missing items, conflicts and warnings. A badge shows how many notices need attention. For a re-check (증분 재확인), also the approval it is based on, the files and materials changed since, and unlinked changes. |
| PR 요약 (PR summary) | Edit, add or remove summary bullets, or reset them to the draft |
| decision | Approve, reject or hold each item. New items can have their title and body edited. A "decision 모두 승인" (approve all decisions) button is available. |
| axiom | Approve, reject or hold each item. Axioms are never included in a bulk approval. |
| 승인 내용 (approval) | Shown after approval: final summary, decision per item, signing key fingerprint |

- **Edits and updates.** If the agent resubmits the draft while you are editing, your input stays and a "새 초안이 있음" (new draft available) banner appears.
- **Approve button.** It is enabled only after every item has a decision.
- **Re-check after approval.** When the code changed after an approval ([Workflow](workflow.md#changes-after-approval)), items that keep their approval are marked "승인 유지" (approval kept) and folded; summary bullets that keep it are read only. Items up for re-check show why, and the approved version under "지난 승인 내용". "다시 검토" (review again) opens a kept item for a decision. Only open items need a decision; if none is open, one confirmation of the summary is enough.
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
