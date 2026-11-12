# 데이터 위치

[English](../en/data.md)

Heirloom은 데이터를 두 곳에 둡니다. 저장소에는 팀이 공유할 기록만 두고, 작업 상태와 승인, 키는 사용자 컴퓨터에 둡니다.

## 소비 프로젝트: `<저장소>/.heirloom/`

모두 커밋 대상입니다. 작업 상태나 승인 기록은 두지 않으므로 `.gitignore`가 필요 없습니다.

| 경로 | 내용 |
| --- | --- |
| `decisions/d-<id>.md` | decision 기록. JSON 앞머리와 본문(문제, 선택과 이유, 버린 대안, 적용 범위) |
| `axioms/a-<id>.md` | axiom 기록. 유지할 성질, 적용 범위와 조건, 예외, 점검 지침 |
| `config.json` | 선택. [프로젝트 설정](configuration.md#프로젝트-설정) |

- **비활성 기록.** 대체·폐기된 기록은 지우지 않습니다. `active: false`로 남겨 이력을 보존합니다.
- **직접 편집 금지.** 기록 파일은 손으로 고치지 마세요. 바꿔야 하면 에이전트에게 수정·대체 초안을 요청하고 대시보드에서 승인합니다. PR 리뷰에서 고친 문구는 머지된 내용이 기준이 됩니다.

## 사용자 로컬: `~/.heirloom/`

환경 변수 `HEIRLOOM_HOME`으로 위치를 바꿀 수 있습니다. 디렉터리는 0700, 파일은 0600으로 만듭니다.

| 경로 | 내용 |
| --- | --- |
| `config.json` | 선택. [사용자 설정](configuration.md#사용자-설정) |
| `index.json` | 작업 트리 등록부와 작업 키 → 작업 ID 매핑 |
| `tasks/<taskId>/input.json` | 인계 때 고정한 입력(소스 상태, 자료) |
| `tasks/<taskId>/draft.json`, `draft.initial.json` | 에이전트 초안과 최초 초안 사본 |
| `tasks/<taskId>/check.json` | 출처 검사 결과 |
| `tasks/<taskId>/handoff.md` | 사람이 읽는 인계 파일 |
| `tasks/<taskId>/approvals/ap-<id>.json` | 서명된 승인 기록 |
| `tasks/<taskId>/events.jsonl` | 작업 이벤트 로그 |
| `keys/current.json` | 현재 서명 키의 공개키 지문과 개인키 보관 위치 |
| `keys/private.key` | 키체인을 쓸 수 없을 때만 있는 개인키(0600) |
| `keys/public/<지문>.pub` | 지금까지 쓴 모든 공개키 |
| `server/server.json`, `server/server.log` | 대시보드 서버 정보와 로그(승인 요청 감사 기록 포함) |

## 지워도 되는 것과 안 되는 것

| 대상 | 지워도 되나요 |
| --- | --- |
| `server/` | 서버가 꺼져 있으면 지워도 됩니다. 다음에 다시 만들어집니다. |
| 끝난 작업(PR 작성, 폐기, 만료)의 `tasks/<taskId>/` | 지워도 됩니다. 저장소의 기록 파일에는 영향이 없습니다. |
| 진행 중인 작업의 `tasks/<taskId>/` | 지우면 그 인계와 승인을 잃습니다. |
| `keys/public/` | 지우지 마세요. 과거 승인의 서명을 검증할 수 없게 됩니다. |
| `keys/private.key` 또는 키체인 항목 | 지우면 다음 승인 때 새 키가 만들어집니다. 이전 승인 검증에는 공개키만 필요합니다. |
