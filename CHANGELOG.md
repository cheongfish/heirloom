# 변경 이력

이 문서는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따릅니다. 버전은 `main`의 태그와 같습니다.

## [Unreleased]

### 추가

- 탐침 실행(`prepare-handoff/scripts/probe.mjs --task <taskId> --file <probes.json>`). 에이전트가 적은 탐침 명령과 테스트 명령을 Heirloom이 base(고정된 merge-base)와 head(인계한 소스 상태, 커밋하지 않은 변경 포함)의 임시 worktree에서 직접 실행합니다. 종료 코드, 출력, 실행 시간과 출력 해시, 탐침 묶음 해시(`probeSetHash`)를 작업의 `probes/`에 남기고, 테스트별 결과가 달라진 테스트를 모읍니다. 테스트 출력은 `node --test --test-reporter=tap`, `pytest -v`, `jest --json`을 읽고, 읽지 못하면 종료 코드만 비교합니다. 프로젝트 설정 `probe.setup`, `probe.maxProbes`(기본 10), `probe.setupTimeoutSeconds`, `probe.testTimeoutSeconds`를 더했습니다.
- 인계 초안 스키마 2. `summary`와 `records` 대신 탐침을 근거로 한 동작 차이 설명(`behaviorDiffs`)과 사람에게 물을 질문(`questions`: `predict`, `test-lock`, `intent`, `fork`), 탐침으로 확인하지 못한 주장(`inferences`)을 씁니다. 제출할 때 초안이 마지막 탐침 실행(`probeSetHash`)을 가리키는지, 설명 속 숫자와 따옴표 친 문자열이 인용한 탐침의 명령이나 출력에 있는지, `test-lock`이 결과가 달라진 테스트나 이번 변경이 고친 테스트 파일의 줄을 가리키는지, spec과 대화 인용이 원문과 맞는지 검사합니다. 읽기용 인계 파일(`handoff.md`)에는 사람이 예측하기 전에 볼 수 없도록 관측값과 동작 차이 설명을 넣지 않습니다. `prepare-handoff` 스킬은 입력 고정 뒤 탐침을 실행하고 스키마 2로 초안을 쓰도록 바뀌었습니다. 대시보드와 반영 단계가 스키마 2를 읽기 전까지는 스키마 1 초안도 계속 검사합니다.
- 예측과 판정 화면. 스키마 2 초안은 대시보드에서 먼저 `predict`·`test-lock` 질문의 결과를 예측해 저장하고(`/api/tasks/<id>/predict`), 그 뒤에야 탐침 출력, 동작 차이 설명, 결과가 바뀐 테스트가 공개됩니다. 공개 전에는 서버가 이 값들을 보내지 않고, 저장한 예측은 바꿀 수 없습니다. 질문마다 `예상대로`, `잘못 알았음`, `답함`(열린 선택), `되돌림`, `분리` 중 하나로 판정하고, 되돌림과 분리에는 이유가 필요합니다. 숫자 예측이 틀렸으면 `예상대로`로 판정할 수 없습니다. 동작 차이 문장은 고칠 수 있지만 숫자와 따옴표 친 관측값은 바꿀 수 없습니다. 판정은 `headSha`, 탐침 출력 해시와 함께 서명해 승인 기록 자리에 둡니다(`/api/tasks/<id>/judge`). 모두 수용하면 `approved`, 되돌림이나 분리가 있으면 새 상태 `returned`가 됩니다. `wait-approval`은 `returned`와 이유를 돌려주고, 세션 시작에도 되돌린 작업과 이유가 보이며, 다음 `prepare` 결과의 `previousJudgment`에 담깁니다.
- 판정 반영. 수용된 판정은 `apply.mjs`에서 기록 파일 없이 PR 단계로 넘어갑니다. `apply-approval/scripts/pr-body.mjs`가 서명된 판정에서만 "사람이 확인한 동작" 단락을 만들어 PR 본문 파일의 표시 구간에 넣거나 바꿉니다. 틀린 예측과 실행 증거 없는 주장도 그대로 남깁니다. `complete.mjs`는 판정한 코드와 정확히 같은 커밋에 `heirloom/understood` commit status를 올립니다(GitHub, GitLab). 판정 뒤 Markdown만 바뀐 경우에는 반영을 막지 않고, 코드가 바뀌면 `stale`로 멈춥니다.
- 판정 이후 재확인. 판정 뒤 코드가 바뀌어 다시 인계하면 `prepare`가 `recheck`(`kind: "probes"`)에 바뀐 파일과 어느 동작 차이 설명에도 연결되지 않은 변경(`unlinked`)을 담습니다. 같은 탐침을 새 head에서 다시 돌렸을 때 질문이 그대로이고 근거 탐침 출력(테스트 결과 포함)의 해시가 같으면 이전 판정을 유지하고, 다르면 다시 묻습니다. 새 판정은 `basedOn`으로 이전 판정을 가리키고 유지한 항목을 `carried`로 표시합니다.
- spec 처리. 되돌리거나 분리한 질문이 spec 줄을 인용했다면 판정 화면에서 spec을 어떻게 할지(`spec이 틀렸다`, `미룬다`, `spec은 스냅샷`)도 함께 고르고, 인용한 줄과 함께 판정에 서명해 둡니다. 다음 `prepare`의 `previousJudgment`에 담기고, 세션 시작과 `wait-approval`에도 보입니다. `spec이 틀렸다`나 `미룬다`를 고른 줄이 다음 인계에서 글자 그대로 남아 있으면 `submit-draft`가 초안을 거부합니다(인용한 줄 옆에 줄만 더한 것은 바뀐 것으로 보지 않습니다). 스냅샷으로 둔 부분은 PR 단락에 "구현하지 않음"으로 남습니다.
- spec 수명. 모든 질문을 수용할 때 이번 작업의 spec을 머지 뒤 삭제, `docs/specs/archive/`로 보관, 유지 중에서 고릅니다. 유지하면 소유자를 적어야 합니다. 기본값은 프로젝트 설정 `spec.afterMerge`(`delete`, `archive`, `keep`, 기본 `delete`)입니다. `apply.mjs`가 고른 대로 spec을 `git rm`이나 `git mv`로 처리하고 결과를 `spec`에 돌려주며, PR 단락에도 남깁니다. 커밋하지 않은 변경이 있는 spec은 커밋할 때까지 건드리지 않고, Markdown이 아닌 spec은 옮기거나 지우지 않습니다.
- 좁은 결정 기록. `fork` 질문에 에이전트가 결정 기록안(`decision`: 범위 `scope`, 앵커 `anchors`, 대체할 기록 `replaces`)을 붙이면, 사람이 답할 때 "이 PR에서만"(기본)과 "저장소에 계속 유지" 중에서 고릅니다. 유지하면 `apply.mjs`가 `.heirloom/decisions/d-….md`에 새 형식(스키마 2)의 기록을 쓰고, 대체한 기록은 같은 PR에서 지웁니다. 앵커는 결정을 지금 구현하는 파일의 이름이나 잠그는 테스트이며, 테스트 앵커가 하나 이상 있어야 합니다. 제출할 때 앵커 파일과 이름이 저장소에 있는지, 테스트가 마지막 탐침 실행의 head에서 통과했는지 검사합니다. `fork` 질문의 `retires`로 더 이상 맞지 않는 기록을 지울지 물을 수 있습니다.
- 결정 기록 회수의 앵커 확인. `recall-context`가 기록을 돌려줄 때마다 앵커를 확인해 `anchorCheck`를 붙입니다. 파일이나 이름이 사라졌거나, 잠그는 테스트가 이 저장소의 가장 최근 탐침 실행에서 실패했으면 `possibly-stale`이고, 에이전트는 따르지도 무시하지도 않고 사람에게 묻습니다. 다른 작업이 남기거나 지운, 아직 머지되지 않은 기록은 `pendingWarnings`(`add`, `retire`)로 알립니다.
- 토론에서 확정된 결정. 코드나 커밋에 흔적 없이 PR 리뷰 댓글이나 이슈에서 정한 결정을 에이전트가 초안의 `discussions`(댓글 URL, 정확한 인용, 결정 한 줄, 범위, 앵커)로 올립니다. 제출할 때 Heirloom이 `gh`나 `glab`으로 그 댓글(또는 PR·MR·이슈 본문)을 직접 가져와 이 저장소의 토론인지, 인용이 원문에 있는지 검사하고 작성자를 남깁니다. 사람이 판정 화면에서 "확정된 결정이 맞다"고 확인한 것만 수용 시 결정 기록이 되고, 기록하지 않기로 한 후보는 작업을 되돌리지 않습니다.
- PR을 연 뒤의 push. 판정한 코드와 다른 코드가 올라오면 세션 시작 블록이 "판정은 abc1234 기준인데 그 뒤 코드가 바뀜"을 알리고(머지된 작업은 제외), stop 훅의 재확인 안내도 새 커밋에 판정 상태가 없음을 말합니다. `prepare` 결과의 `openPr`이 열린 PR과 판정 커밋을 알려 주며, `pr-body.mjs --rechecking`이 PR 단락 첫 줄을 "재확인 중"으로 바꿉니다. 판정만 있는 작업도 브랜치가 대상 브랜치에 들어가면 머지된 것으로 봅니다.

- 반복된 되돌림 권고. 같은 질문(같은 id)을 두 번째로 되돌리면 대시보드가 그 질문과 작업 개요에 "설계부터 다시 합의하세요"을 보여 주고, 이전 라운드의 되돌림 이유를 함께 보여 줍니다. 판정 화면 응답의 질문마다 `returns`(이전 되돌림)가, 작업 응답에 `repeatedReturns`가 생겼습니다. 에이전트는 `prepare`의 `previousJudgment.returned[].timesReturned`와 `wait-approval`의 `returned[].timesReturned`로 횟수를 받고, 2 이상이면 다시 고치기 전에 사용자에게 설계 합의를 권합니다. PR을 막는 것 외에 자동으로 하는 일은 없습니다.

- 탐침 실행 허락. `probe.mjs`가 준비 명령, 탐침, 테스트 명령을 실행하기 전에 명령 전체를 대시보드 "탐침 실행 허락" 화면에 보이고, 사람이 허락할 때까지 기다립니다(기본 8분, `--timeout-minutes`). 허락과 거절은 사용자 키로 서명해 작업의 `probe-permits/`에 둡니다. 거절에는 이유가 필요하고, 에이전트는 이유가 담긴 `E_INPUT`을 받아 탐침 파일을 고칩니다. 같은 저장소에서 허락한 명령(인자 목록이 글자 그대로 같은 것)은 다시 묻지 않습니다. 시간 안에 답이 없으면 `permission.state: "pending"`을 돌려주고, 같은 명령을 다시 실행하면 같은 요청을 이어서 기다립니다. 탐침 실행 기록(`probes/result.json`)과 결과에 허락 id(`permit`, `permission`)가 남습니다. 전체 목록에 "탐침 실행 허락 대기" 구역이 생겼습니다.

### 변경

- 사용자 문서(README, `docs/agent/`)를 판정 흐름에 맞춰 고쳤습니다. 탐침·예측·판정, PR 단락과 `heirloom/understood` commit status, spec 처리와 `spec.afterMerge`, 좁은 결정 기록과 앵커 확인을 설명하고, commit status를 브랜치 보호의 머지 조건으로 거는 방법과 0.4 이전 기록(스키마 1 결정, axiom)을 다루는 방법을 더했습니다.
- 0.4 이전 형식의 기록(스키마 1 결정, axiom)은 과거 기록으로만 읽습니다. `recall-context`는 이 기록을 규칙(`records`)으로 돌려주지 않고 `legacy`에 id와 파일만 알리며, 세션 시작의 결정 기록 범위에도 넣지 않습니다. 저장소의 기록 파일은 지우지 않습니다. `recall-context`의 결과에서 `inactive`가 없어지고 `legacy`가 생겼으며, `records` 항목은 `title`·`kind` 대신 `choice`·`anchorCheck`·`anchors`를 씁니다.
- 세션 시작 블록을 줄였습니다. 활성 axiom 목록, decision 색인(제목과 `[관련]` 표시), 다른 작업의 머지 대기 변경, 머지 판정 줄을 빼고, 규칙 두 줄과 결정 기록이 걸린 경로 목록만 넣습니다. 결정 원문은 그 경로를 고치기 전에 `recall-context`로 읽습니다. 프로젝트 설정 `sessionIndex.maxDecisions`는 더 이상 쓰지 않으며, 기존 설정 파일에 있어도 무시합니다.

### 제거

- 맥락 정리를 지웠습니다. 효용을 측정한 적이 없고, 헤드리스 실행과 전용 worktree 관리 비용이 컸습니다. `curate-decisions` 스킬, 대시보드의 '맥락 정리' 목록과 '정리 실행'·'다시 실행', 정리 검토 화면, axiom 후보의 보류·거절 이유, 헤드리스 실행(`agent-runner.mjs`)과 Codex 허용 목록 훅(`hook-allowlist.mjs`)이 없어졌습니다. 저장소의 `.heirloom/curation/` 검토 이력은 더 이상 읽지 않습니다. 설정 `curation.*`(사용자·프로젝트)은 기존 파일에 있어도 무시합니다. 진행 중이던 정리 작업이 있었다면 `~/.heirloom/worktrees/` 아래 worktree를 저장소에서 `git worktree remove`로 지웁니다.
- 스키마 1 인계와 항목별 승인을 지웠습니다. 인계 초안은 스키마 2만 받고(`summary`, `records`와 그 연산 `add`·`update`·`supersede`·`deprecate`·`relate`가 없어짐), 대시보드의 요약·결정·axiom 탭과 항목별 승인·빠른 승인, `/api/tasks/<id>/approve`, 항목 기반 증분 재확인, 기록 쓰기(`record-changes`)가 없어졌습니다. 새로 쓰는 기록은 판정에서 나온 결정 기록뿐이며 axiom과 관계는 더 이상 만들지 않습니다. `apply.mjs` 결과에서 `summary`, `records`, `pendingItems`가 빠졌습니다. 0.4 이전에 항목별로 승인된 작업은 반영하지 않고(`E_VERIFY`), `prepare-handoff`로 다시 인계하면 새 판정 라운드가 시작됩니다.
- spec 위치 등록 흐름을 지웠습니다. 인계한 spec이 `specGlobs`에 맞지 않을 때 패턴 추가를 제안하던 `prepare.mjs`의 `specCoverage`와 `prepare-handoff/scripts/add-spec-globs.mjs`가 없어졌습니다. `specGlobs` 설정과 stop 훅의 spec 감지는 그대로이며, 필요하면 `.heirloom/config.json`에 직접 패턴을 더합니다.

## [0.3.6] - 2026-11-16

### 변경

- 대시보드 "작업 폐기" 버튼을 하단 승인 바에서 작업 화면 위쪽 브랜치 줄 오른쪽으로 옮겼습니다. 자주 쓰지 않고 되돌릴 수 없는 동작이라 승인 저장 옆에 두지 않습니다.
- 좁은 창에서 하단 승인 바를 줄였습니다. 상태 글을 작게 쓰고 "다음 미처리 항목으로"와 "승인 저장"을 한 줄에 둡니다(375px 폭에서 199px → 139px).

### 수정

- 상단 "Heirloom" 링크, "← 전체 목록", 개요의 접힘 줄이 24px보다 작던 터치 영역을 24px 이상으로 넓혔습니다.

## [0.3.5] - 2026-11-13

### 변경

- 대시보드 PR 요약을 입력칸 하나로 합쳤습니다. 한 줄에 불릿 하나씩 적고, 제목 오른쪽 "초안 생성" 버튼으로 에이전트 초안을 다시 채웁니다. 승인할 때는 줄마다 초안의 어느 불릿에서 왔는지 다시 맞춰 보내, 증분 재확인이 코드 경로를 계속 이어받습니다.
- 결정 카드가 기본으로 읽기 보기입니다. 채워진 필드만 보이고 빈 필드는 한 줄로 알리며, "편집"을 누른 카드만 입력 폼으로 바뀝니다. 고친 카드에는 "고침" 배지가 붙습니다. 긴 제목은 줄바꿈해 모두 보입니다.
- 화면 용어를 README와 같이 결정(decision)·규칙(axiom)으로 맞췄습니다.
- 전체 목록에 "반영 대기" 섹션을 두어 승인 후 반영·PR을 기다리는 작업을 진행 중 작업과 나눴습니다. 빈 섹션은 카드 대신 한 줄로 알리고, 섹션 설명과 작업 화면의 상태 설명·저장소 경로·승인자 줄을 걷어 화면을 줄였습니다.
- 개요의 변경 파일을 신규·수정·삭제로 나눠 보여 줍니다.
- "결정 모두 승인"을 "남은 결정 모두 승인"으로 바꾸고 확인 창을 띄웁니다. 이미 거절·보류로 고른 항목은 바꾸지 않습니다.
- 승인 저장이 막힌 이유를 버튼 옆에 보여 주고, "다음 미처리 항목으로" 버튼으로 해당 카드로 이동합니다.
- 작업 줄에 마우스를 올리거나 키보드로 포커스하면 주황색으로 강조합니다.

### 수정

- 좁은 창에서 긴 코드 경로, 경고 문구, 키 지문이 화면 밖으로 넘쳐 가로 스크롤이 생기던 문제를 고쳤습니다. 좁은 창에서는 라벨을 값 위에 둡니다.
- 검사 경고가 `$.records[0].codePaths[1]` 같은 내부 경로 대신 항목 번호와 제목, 필드 이름으로 보입니다.
- 상단바 아래에 붙는 탭과 배너의 위치를 고정값 대신 상단바 높이로 맞춥니다.

## [0.3.4] - 2026-11-13

### 수정

- 조회 조건 없이 결정을 회수했는데 대상 브랜치 대비 바뀐 코드 파일도 없으면, 이제 빈 결과 대신 입력 오류(종료 코드 2)로 끝나고 `--paths`·`--topics`를 넘기라고 안내합니다. 새 작업을 시작할 때 빈 결과가 '관련 결정 없음'으로 읽히던 문제를 고쳤습니다.
- 결정 회수 규약을 보완했습니다. 에이전트는 아직 바꾸지 않은 파일이라도 수정할 경로로 코드를 고치기 전에 회수합니다. 결과가 비었거나 일부가 제외·누락되거나 읽지 못했을 때는 확인한 범위를 사용자에게 알리고, 규칙을 찾으려고 `.heirloom/` 기록 파일을 직접 읽지 않습니다.

## [0.3.3] - 2026-11-13

### 추가

- Cursor CLI(`agent`) 지원(잠정 등급 B). 전용 매니페스트 `.cursor-plugin/plugin.json`이 Cursor 형식 훅 파일 `hooks/hooks-cursor.json`(sessionStart)과 상시 규칙 `.cursor-plugin/rules/heirloom.mdc`를 가리킵니다. 인계, 대화에서 정한 결정 기록, 승인 반영, 결정 회수가 동작합니다. Cursor CLI가 stop 훅을 실행하지 않아 종료 시 상기는 없습니다. 설치는 `agent --plugin-dir <클론>`으로 확인했습니다.
- Cursor에서는 인계 준비가 에이전트 셸의 `CURSOR_CONVERSATION_ID`·`AGENT_TRANSCRIPTS`로 자기 세션 기록을 찾아, 같은 폴더에서 세션이 겹쳐도 대화를 정확히 고정합니다.

### 수정

- 훅 입력의 `cwd`가 git 저장소가 아니면 작업 폴더 목록에서 첫 git 저장소를 씁니다. Antigravity에서 `--add-dir`로 더한 폴더가 앞에 오면 훅이 저장소 밖에서 판정해 상기와 세션 기록이 빠지던 문제를 고쳤습니다.
- 에이전트가 Heirloom 상태를 직접 고쳐 우회하지 않도록 스킬과 상시 규칙에 금지를 더했습니다. Heirloom은 스킬에 적힌 스크립트로만 실행하고 `~/.heirloom/`을 고치지 않으며, 막히면 사용자에게 알립니다.

## [0.3.2] - 2026-11-13

### 추가

- 대화 출처. 채팅에서 사용자가 정한 결정을 그 발화를 인용해 기록할 수 있습니다. 인계 준비가 이번 세션에서 사람이 입력한 발화만 고정하고(`~/.heirloom/tasks/<taskId>/conversation.json`), 초안은 `"ref": "@conversation"`으로 발화 하나의 일부를 인용하며, 출처 검사가 고정한 발화에서 인용을 찾습니다. 에이전트의 답, 도구 결과, 호스트가 사용자 자리에 넣는 글은 출처가 되지 않습니다. Claude Code, Codex, Antigravity 세션 기록을 읽습니다.
- 세션 시작·종료 훅이 작업 트리마다 세션 기록 경로를 남깁니다(`~/.heirloom/sessions/`). 같은 작업 트리의 세션이 최근에 겹쳤으면 어느 세션인지 추측하지 않고 대화를 미확인으로 둡니다.

### 변경

- spec과 연결되지 않은 코드 변경이 있으면 종료 훅이 수동 인계를 쓸 수 있다고 세션당 한 번 안내합니다. 인계는 여전히 사용자가 요청할 때만 합니다.

## [0.3.1] - 2026-11-13

### 수정

- 훅 진입점(`hooks/`의 bash 스크립트와 `run-hook.cmd`)을 `.gitattributes`로 LF에 고정했습니다. Windows에서 `core.autocrlf=true`로 설치본을 clone하면 CRLF 때문에 훅이 `$'\r': command not found`로 조용히 실패할 수 있었습니다. `.gitattributes`는 릴리스 트리에도 들어갑니다.

## [0.3.0] - 2026-11-13

### 추가

- Codex 지원(잠정 등급 A). 전용 매니페스트 `.codex-plugin/plugin.json`이 Claude Code와 같은 스킬과 훅 파일을 씁니다. 훅은 Codex 세션의 `/hooks`에서 신뢰해야 실행됩니다. 종료 훅은 Codex 세션 기록의 셸 명령에서 세션이 읽은 spec을 찾습니다.
- Antigravity CLI 지원(잠정 등급 A). 전용 매니페스트 `.antigravity-plugin/plugin.json`, 플러그인 루트의 `hooks.json`, 압축 뒤에도 남는 상시 규칙 `rules/heirloom.md`를 둡니다. 종료 훅은 정상 종료(`NO_TOOL_CALL`)에서만 상기하므로 취소·오류·`/compact` 뒤에 작업을 재개시키지 않습니다.
- 맥락 정리의 Codex·Antigravity 헤드리스 프로필. 단계별 허용 범위를 호스트 중립 정책으로 정하고, Codex는 실행별 허용 목록 훅(`hook-allowlist.mjs`), Antigravity는 실행별 권한 규칙으로 제한합니다. Codex 반영 단계는 샌드박스가 `.git`을 쓸 수 없어 샌드박스 없이 허용 목록 훅만으로 실행합니다.
- 피드백 이슈 양식(`.github/ISSUE_TEMPLATE/feedback.yml`).

### 변경

- 맥락 정리는 그 저장소의 마지막 세션 호스트로 실행합니다. 세션 시작 훅이 작업 트리마다 호스트를 기록하고, 기록이 없을 때만 사용자 설정 `curation.agent.host`를 씁니다. 대시보드가 실행할 호스트를 보여 줍니다.
- 사용자 설정 `curation.agent.host`가 `codex`, `antigravity`를 받고, `command`의 기본값이 호스트마다 다릅니다(`claude`, `codex`, `agy`).
- 사용자 문서를 사람이 읽는 짧은 README와 에이전트가 읽는 영어 문서(`docs/agent/`)로 나눴습니다. `docs/guide/`는 없어졌습니다.

### 수정

- 저장소의 `.git`에 쓸 수 없으면(Codex 기본 샌드박스) 저장소·worktree ID를 `~/.heirloom/ids/`에 저장합니다. 전에는 인계가 `EROFS`로 실패했습니다.

## [0.2.1] - 2026-11-13

### 수정

- 증분 재확인 뒤 기존 PR 본문을 고칠 때 `gh pr edit` 대신 GitHub REST API(`gh api -X PATCH repos/<repo>/pulls/<n> -F body=@<파일>`)를 씁니다. 일부 gh 버전(예: 2.45)에서 `gh pr edit`가 GraphQL 오류로 실패하던 문제입니다. 헤드리스 정리의 반영 단계 허용 도구도 같이 바꿨습니다.

### 변경

- 헤드리스 정리의 허용 도구에서 Claude Code가 파일 쓰기 확인에 쓰지 않는 `Write(…)` 규칙을 빼고 `Edit(…)`만 남겼습니다.

## [0.2.0] - 2026-11-13

### 추가

- 인계한 spec이 프로젝트의 spec 위치 설정(`specGlobs`)에 맞지 않으면 에이전트가 알리고, 사용자가 동의하면 `.heirloom/config.json`을 만들거나 패턴을 더합니다(`prepare-handoff/scripts/add-spec-globs.mjs`).
- 종료 훅이 이번 세션에서 읽은 spec도 spec 기반 작업의 근거로 봅니다(Claude Code의 세션 기록). 대상 브랜치에 이미 있던 spec으로 작업해도 인계를 상기합니다.
- 프로젝트 설정 `testCadence.mode`. `"phase"`로 켜면 계획의 작업을 phase로 묶고, 작업마다 그 작업의 테스트만 돌리고, 전체 테스트는 phase 관문과 마지막에만 돌리도록 세션 시작 규칙을 더합니다.
- 저장소 PR 템플릿(`.github/pull_request_template.md`).

### 변경

- `main`과 `release` 반영은 PR로만 하고, 버전과 변경 이력은 `main`에서 관리합니다. `tools/build-release.mjs`는 `release`를 직접 고치지 않고 임시 브랜치에 빌드 커밋을 만듭니다.

## [0.1.0] - 2026-11-13

### 추가

- spec 기반 작업의 인계, 로컬 대시보드에서의 서명 승인, decision·axiom 기록 반영, PR 작성, 다음 작업에 활성 기록 제공.
- 승인 이후 바뀐 부분만 다시 확인받는 증분 재확인.
- GitLab MR 작성과 MR 닫힘 만료(`glab`).
- 여러 작업의 decision을 묶어 검토하는 별도 맥락 정리와 axiom 후보.
