# 변경 이력

이 문서는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따릅니다. 버전은 `main`의 태그와 같습니다.

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
