# 설정

[English](../en/configuration.md)

설정 파일은 모두 선택입니다. 없으면 기본값을 씁니다. 모든 항목을 기본값으로 채운 예시 파일을 복사해서 필요한 값만 바꾸세요.

| 설정 | 위치 | 예시 |
| --- | --- | --- |
| 사용자 설정 | `~/.heirloom/config.json` | [`examples/user-config.example.json`](../../../examples/user-config.example.json) |
| 프로젝트 설정 | `<저장소>/.heirloom/config.json` (커밋 대상) | [`examples/project-config.example.json`](../../../examples/project-config.example.json) |

```sh
cp examples/user-config.example.json ~/.heirloom/config.json
cp examples/project-config.example.json <저장소>/.heirloom/config.json
```

JSON이라 주석을 넣을 수 없습니다. 알 수 없는 키나 범위를 벗어난 값이 있으면 오류로 알려 줍니다. 두 파일 모두 `"schemaVersion": 1`이 필요합니다.

## 사용자 설정

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `dashboard.port` | `17380` | 대시보드 포트(1024–65535). 바꾸면 다음 서버 시작부터 적용됩니다. 실행 중인 서버는 유휴 종료되거나 다시 시작될 때 새 포트로 뜹니다. |
| `dashboard.idleMinutes` | `30` | 열린 화면도 요청도 없을 때 서버가 종료되기까지의 분 |
| `dashboard.openBrowser` | `true` | 인계 뒤 브라우저를 자동으로 열지 여부. 직접 여는 요청에는 영향이 없습니다. |
| `dashboard.staleDays` | `7` | 전체 목록에서 '오래된 미처리 건'으로 보이는 기준(일) |
| `curation.agent.host` | `"claude-code"` | 저장소의 세션 기록이 없을 때 [맥락 정리](curation.md)에 쓰는 헤드리스 에이전트 프로필: `claude-code`, `codex`, `antigravity`. 정리는 보통 그 저장소의 마지막 세션 호스트로 실행합니다. |
| `curation.agent.command` | 프로필별 `"claude"`, `"codex"`, `"agy"` | 정리 때 대시보드가 실행하는 명령. `PATH`에 있는 이름이나 절대 경로. 대시보드 요청으로는 바꿀 수 없습니다. |
| `curation.agent.model` | `null` | 헤드리스 에이전트에 넘길 모델(`--model`, Codex는 `-m`). `null`이면 명령의 기본값을 씁니다. |

## 프로젝트 설정

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `baseBranch` | 없음 | PR 대상 브랜치. 없으면 `origin/HEAD`를 씁니다. 둘 다 없거나 원격이 여러 개라 불명확하면 추측하지 않고 오류로 알려 줍니다. |
| `specGlobs` | `["docs/superpowers/specs/**", "**/specs/**/*.md"]` | spec 문서로 볼 경로. 종료 훅의 인계 상기 조건에 씁니다. 인계한 spec이 여기에 맞지 않으면 에이전트가 패턴 추가를 제안하고, 동의하면 이 파일을 만들거나 패턴을 더합니다. |
| `recall.maxRecords` | `8` | 맥락 조회 때 가져올 기록 수 상한 |
| `recall.maxTokens` | `6000` | 맥락 조회 때 토큰 상한. UTF-8 바이트 수 ÷ 3으로 어림합니다(한글 한 글자가 약 1토큰). |
| `sessionIndex.maxDecisions` | `30` | 세션 시작 때 보여 줄 decision 색인 수 |
| `curation.minUnreviewed` | `10` | 미검토 decision이 이 수 이상이면 [맥락 정리](curation.md)를 제안 |
| `curation.maxAgeDays` | `30` | … 또는 마지막 정리 뒤 이 일수가 지났고 |
| `curation.minForAge` | `3` | … 미검토 decision이 이 수 이상이면 제안 |
| `curation.batchSize` | `20` | 정리 한 번에 검토하는 미검토 decision의 최대 수 |
| `testCadence.mode` | `"off"` | 개발 도구(Superpowers 등)가 테스트를 돌리는 주기. `"phase"`로 켜면 세션 시작 때 규칙을 더합니다: 계획의 작업을 phase로 묶고, 작업마다 그 작업의 테스트만 돌리고, 작업 리뷰는 구현자가 보고한 테스트 결과를 근거로 삼고(의문이 있을 때만 대상 테스트), 전체 테스트는 phase 끝과 마지막(최종 리뷰·인계 전)에만 돌립니다. 테스트 명령은 작업 계획에 적힌 것을 따릅니다. |

## 환경 변수

| 변수 | 설명 |
| --- | --- |
| `HEIRLOOM_HOME` | 사용자 로컬 저장소 위치. 기본값은 `~/.heirloom` |
| `HEIRLOOM_PORT` | 대시보드 포트. `dashboard.port`보다 먼저입니다. 주로 개발과 테스트에 씁니다. |
| `HEIRLOOM_KEYSTORE=file` | 키체인 대신 파일에 개인키를 둡니다. 주로 개발과 테스트에 씁니다. |
