# 변경 이력

이 문서는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따릅니다. 버전은 `main`의 태그와 같습니다.

## [Unreleased]

### 추가

- 탐침 실행(`prepare-handoff/scripts/probe.mjs --task <taskId> --file <probes.json>`). 에이전트가 적은 탐침 명령과 테스트 명령을 Heirloom이 base(고정된 merge-base)와 head(인계한 소스 상태, 커밋하지 않은 변경 포함)의 임시 worktree에서 직접 실행합니다. 종료 코드, 출력, 실행 시간과 출력 해시, 탐침 묶음 해시(`probeSetHash`)를 작업의 `probes/`에 남기고, 테스트별 결과가 달라진 테스트를 모읍니다. 테스트 출력은 `node --test --test-reporter=tap`, `pytest -v`, `jest --json`을 읽고, 읽지 못하면 종료 코드만 비교합니다. 프로젝트 설정 `probe.setup`, `probe.maxProbes`(기본 10), `probe.setupTimeoutSeconds`, `probe.testTimeoutSeconds`를 더했습니다.
- 인계 초안 스키마 2. `summary`와 `records` 대신 탐침을 근거로 한 동작 차이 설명(`behaviorDiffs`)과 사람에게 물을 질문(`questions`: `predict`, `test-lock`, `intent`, `fork`), 탐침으로 확인하지 못한 주장(`inferences`)을 씁니다. 제출할 때 초안이 마지막 탐침 실행(`probeSetHash`)을 가리키는지, 설명 속 숫자와 따옴표 친 문자열이 인용한 탐침의 명령이나 출력에 있는지, `test-lock`이 결과가 달라진 테스트나 이번 변경이 고친 테스트 파일의 줄을 가리키는지, spec과 대화 인용이 원문과 맞는지 검사합니다. 읽기용 인계 파일(`handoff.md`)에는 사람이 예측하기 전에 볼 수 없도록 관측값과 동작 차이 설명을 넣지 않습니다. `prepare-handoff` 스킬은 입력 고정 뒤 탐침을 실행하고 스키마 2로 초안을 쓰도록 바뀌었습니다. 대시보드와 반영 단계가 스키마 2를 읽기 전까지는 스키마 1 초안도 계속 검사합니다.

### 변경

- 세션 시작 블록을 줄였습니다. 활성 axiom 목록, decision 색인(제목과 `[관련]` 표시), 다른 작업의 머지 대기 변경, 머지 판정 줄을 빼고, 규칙 두 줄과 결정 기록이 걸린 경로 목록만 넣습니다. 결정 원문은 그 경로를 고치기 전에 `recall-context`로 읽습니다. 프로젝트 설정 `sessionIndex.maxDecisions`는 더 이상 쓰지 않으며, 기존 설정 파일에 있어도 무시합니다.

### 제거

- 맥락 정리를 지웠습니다. 효용을 측정한 적이 없고, 헤드리스 실행과 전용 worktree 관리 비용이 컸습니다. `curate-decisions` 스킬, 대시보드의 '맥락 정리' 목록과 '정리 실행'·'다시 실행', 정리 검토 화면, axiom 후보의 보류·거절 이유, 헤드리스 실행(`agent-runner.mjs`)과 Codex 허용 목록 훅(`hook-allowlist.mjs`)이 없어졌습니다. 저장소의 `.heirloom/curation/` 검토 이력은 더 이상 읽지 않습니다. 설정 `curation.*`(사용자·프로젝트)은 기존 파일에 있어도 무시합니다. 진행 중이던 정리 작업이 있었다면 `~/.heirloom/worktrees/` 아래 worktree를 저장소에서 `git worktree remove`로 지웁니다.
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
