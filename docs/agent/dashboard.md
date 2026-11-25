# Dashboard

The dashboard is a local web page where a human predicts, then judges, what a handed-off change does. One server per user runs on `127.0.0.1`.

## Opening it

- **Automatically.** After a handoff is submitted, the browser opens once per task. Turn this off with the user setting `dashboard.openBrowser`.
- **On request.** Ask the agent to "open the Heirloom dashboard". Add the task ID to open a specific task.
- **Address.** The default is `http://127.0.0.1:17380/`. You can change the port in [Configuration](configuration.md).
- **If no browser opens.** On WSL, Heirloom uses `wslview`, or `cmd.exe /c start` when `wslview` is missing. If nothing works, the agent tells you the address so you can paste it.

## Overview

| Section | Content |
| --- | --- |
| 탐침 실행 허락 대기 (probe permit) | Tasks whose probe commands wait for your allowance before they run. Shown only when there are some. |
| 승인 대기 (awaiting approval) | Handoffs waiting for a human. Always shown. |
| 반영 대기 (waiting to apply) | Accepted tasks whose PR is not open yet (approved, applied). A line under the list says the next step: ask the agent to apply them (apply-approval). |
| 인계되지 않은 변경 (unhanded changes) | Worktrees with code changes but no handoff for their current state |
| 오래된 미처리 건 (stale) | Unfinished tasks whose last activity is older than `dashboard.staleDays` (default 7). They never expire just because time passed. |
| 진행 중 (in progress) | Tasks whose draft is still being prepared, and tasks sent back (되돌림) |
| 최근 끝난 작업 (recently finished) | The last ten finished tasks |

Sections after 승인 대기 are shown only when they have rows. A task row is titled with the draft's one-line work summary (`summary`), or the branch name when the draft has none; under it are the branch, the repository's folder name and the last update. The full path and the task ID are on the task screen. Clicking a task row opens its task screen; the row turns orange on hover or keyboard focus.

When the overview is shown, tasks whose PR or MR was created are checked with `gh` or `glab` in the background, so the list never waits for the network. A PR or MR closed without merge marks its task as expired (만료됨), and open screens update. A merged one is not checked again; others are checked again after five minutes. Without `gh` or `glab` nothing changes.

## Task screen

The task header shows the draft's work summary (or branch name), state, repository name, `branch → base`, changed file count and spec references. The task ID and full repository path are under **자세히** in the overview.

| Tab | Content |
| --- | --- |
| 개요 (overview) | 동작 차이 (behavior differences) first: as judged, or as the agent wrote them; before the predictions are saved only a note, since they hold observed values. Then notices (warnings, missing review or materials as 인계에 빠진 자료, for a recheck the judgment it builds on), and 작업 경계 (task boundary): changed files grouped as 신규/수정/삭제 (new/modified/deleted), folded, and 자세히 (details) with the repository path, reviewed source state, handoff trigger, preparation time and materials. A badge shows how many notices need attention. |
| 예측 n/m → 판정 n/m (predict → judge) | The questions. The label counts what is done. |

### Question cards

Questions (and discussion candidates) are cards reviewed side by side, one in view at a time, instead of one long column. Move with **← 이전** / **다음 →**, the question chips above the cards (a done card shows ✓), or a horizontal swipe; the buttons and chips go straight to the card. The line next to the title counts the cards and how many are done, and one line under it explains the words the cards use (탐침 before the reveal, 되돌림 and 분리 after). On a narrow or touch screen, buttons, choices and the ← 전체 목록 link are at least 44px tall.

### Allowing probe commands

Before Heirloom runs the agent's probes, the task screen opens on **탐침 실행 허락** (allow probe commands). One line says why: to run the change on base and head and see what it actually does. It lists every command that would run on base and head: setup commands (준비), probes (탐침, with id and title) and the test command (테스트), each in full. Commands you allowed before in this repository are marked 이전에 허락함; the others 새 명령 (new).

- **허락하고 실행** (allow and run) signs the allowance after a confirmation; the waiting agent starts the run. The same commands are not asked again in this repository.
- **거절** (deny) needs a reason. The agent gets it and changes its probes file.

The browser opens once per new request, as after a submit (`dashboard.openBrowser`).

### Before the reveal

The questions are shown with the full probe commands, so you can see what will run. Nothing that shows a result is on the page yet: the server does not send it.

- `predict` questions show four choices, one per line, including when the result is a number. `test-lock` questions show 예 / 아니오 (yes / no), the test assertion in plain words, and the test name under **자세히**.
- If a pending draft from an earlier version asks for a typed number, ask the agent to add four choices and resubmit it. A draft whose predictions are already saved can still be judged.
- Questions whose verdict is kept from the previous judgment are listed under "이전 판정 유지" (previous judgment kept) and are not asked.
- **예측 저장하고 결과 보기** (save predictions and reveal) is enabled once every question has a prediction, and asks for a confirmation: saved predictions cannot be changed. While it is disabled, the line next to it says what is missing.

### After the reveal

- **동작 차이** (behavior differences): the agent's descriptions, each with the probes it rests on (by title). You can reword them; numbers and quoted values cannot be changed.
- **탐침 결과** (probe results): each full probe with its command and its base and head output. The question card shows short outputs next to the judgment and provides **전체 실행 결과 보기** (see full execution result).
- **실행 증거 없음** (no run evidence): claims no probe confirmed.
- **테스트**: pass/fail counts on base and head (e.g. 통과 2 → 통과 1·실패 1) and the tests whose result changed, each by what it asserts in plain words when the draft's `testNotes` says, otherwise by name.
- **Each question**: your prediction with 맞음 / 틀림 / 직접 비교 (right / wrong / compare yourself), the probes it rests on, then the verdict control. A wrong prediction cannot be judged 예상대로 (as expected), and a right one not 잘못 알았음; the line under the control says so. Each verdict option has a tooltip with its meaning.
  - 되돌림 or 분리 asks for a reason (필수, required); when the question cites the spec it also asks for **spec 처리**: spec이 틀렸다, 미룬다, spec은 스냅샷.
  - A question sent back in an earlier round shows those reasons. Sending the same question back a second time turns the note into **설계부터 다시 합의하세요** (agree on the design first): another round of fixes is unlikely to converge. It is only a recommendation; saving works as usual.
  - 답함 on a `fork` question asks for the answer. With a decision proposal it also asks **답을 남길 곳**: 이 PR에서만 (default) or 저장소에 계속 유지, with the tests that lock the decision in plain words. The scope and anchors (files, test names, symbols) are under **자세히** (details). When a question asks whether to retire an existing record, the card shows the recalled choice, scope and any missing or failed anchors before offering to remove it.
- **토론에서 정한 결정** (decision from a discussion): one card per candidate the agent found, with the quote, a link to the comment and its author, and the tests that lock it in plain words (scope and anchors under **자세히**); choose 확정된 결정이 맞다 (it is settled) or 기록하지 않음 (do not record).
- **머지할 때 spec 처리** (spec at merge): shown when no question is sent back and the handoff has a spec. 삭제 / 보관 / 유지, preselected from `spec.afterMerge`; 유지 needs an owner.
- **판정 저장** (save judgment) is enabled when the answers, spec choices and discussion decisions are complete. Until then the note next to it says what is missing, with buttons to open the corresponding cards. With a revert or split the button reads "판정 저장 (작업 되돌림)" and asks for a confirmation.

Confirmations are a dialog in the page, not the browser's: focus starts on the confirming button, which names the step (결과 보기, 저장, 폐기, 실행), and Escape or 취소 cancels.

After saving, **판정 내용** (judgment) shows the outcome (모두 수용 or 되돌림), when it was judged (the judgment ID, judged head and probe set under **자세히**), the behavior differences, each verdict with its answer and reason, spec choices, kept records and the spec lifetime. Records are written only when the work is accepted: a judgment that sends work back says the kept answer is not recorded. While the task waits to be applied, a note above says the next step: ask the agent to apply it (apply-approval). The signing key and approver stay in the signed file.

- **Discard.** "작업 폐기" (discard), a red button at the bottom of the 개요 tab while the task is being judged, ends the handoff after a confirmation. A discarded task cannot be judged or applied.
- **Tasks from before 0.4.** A task whose draft is not schema 2 shows only its overview; hand it off again to judge it.

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
