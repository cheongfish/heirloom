# Heirloom

[English](README.md)

Heirloom은 Superpowers 같은 SDLC 도구로 끝낸 작업을 마무리하는 Claude Code 플러그인입니다. 인계를 준비하고, 사람이 로컬 대시보드에서 PR 요약과 결정(decision)을 승인하게 합니다. 승인된 기록은 저장소에 쓰고 PR을 엽니다. 이후 작업에는 활성 decision과 axiom을 제공합니다.

Heirloom은 개발 작업을 대신하지 않으며, 인계는 승인이 아닙니다. 승인은 사람만, 대시보드에서만 합니다.

> 상태: 0.1(MVP). 일부 기능은 준비 중입니다. [지원 예정](docs/guide/ko/roadmap.md)을 참고하세요.

## 설치

Node 20 이상, git, Claude Code가 필요합니다. PR을 만들 때만 github.com 원격이면 `gh`, GitLab 원격(gitlab.com 또는 자체 호스팅)이면 `glab`이 필요합니다. 따로 설치할 런타임 의존성은 없습니다.

플러그인 파일만 담은 `release` 브랜치에서 설치합니다.

```text
/plugin marketplace add <owner>/heirloom#release
/plugin install heirloom@heirloom
```

설치하지 않고 내려받은 저장소를 한 세션에서만 쓰려면 `claude --plugin-dir /path/to/heirloom`으로 실행합니다.

→ [설치 가이드](docs/guide/ko/installation.md)

## 작업 흐름

1. **인계.** 에이전트가 끝낸 spec 기반 작업을 인계합니다. 초안의 출처 인용은 기계적으로 검사합니다.
2. **승인.** 대시보드에서 요약과 decision·axiom을 항목별로 검토합니다. 승인에는 서명이 붙습니다.
3. **반영과 PR.** 에이전트가 승인을 검증하고 `.heirloom/` 기록을 쓴 뒤, 승인된 요약을 그대로 넣어 PR(GitLab은 MR)을 엽니다. 승인을 기다리던 세션은 승인하는 즉시 이 단계를 진행합니다.
   - 승인 뒤에 코드가 바뀌면(PR을 연 뒤라도) 바뀐 부분과 연결된 항목만 다시 확인받습니다. 나머지는 승인을 유지합니다.
4. **맥락 조회.** 이후 세션은 활성 axiom과 decision 색인을 받고 시작하고, 에이전트가 관련 기록의 원문을 가져옵니다. 기록은 대상 브랜치에 머지되면 활성이 됩니다.

→ [작업 흐름 가이드](docs/guide/ko/workflow.md)

## 맥락 정리

decision이 쌓이면 대시보드가 정리를 제안합니다. 실행을 고르면 헤드리스 에이전트가 전용 worktree에서 decision 묶음을 검토하고 중복 정리, 관계, axiom 후보를 제안합니다. 제안을 항목마다 승인하고(보류·거절한 후보에는 이유를 적습니다), 결과는 PR(GitLab은 MR)로 올라옵니다.

→ [맥락 정리](docs/guide/ko/curation.md)

## 대시보드

`http://127.0.0.1:17380/`에 뜨는 로컬 화면입니다. 전체 목록과 작업별 탭 화면이 있습니다. 인계마다 한 번 자동으로 열리고, 언제든 에이전트에게 다시 열어 달라고 할 수 있습니다. 쓰지 않으면 서버가 스스로 종료됩니다.

→ [대시보드 가이드](docs/guide/ko/dashboard.md)

## 데이터 위치

- `<저장소>/.heirloom/`: decision·axiom 기록과 정리 검토 이력. 커밋 대상입니다.
- `~/.heirloom/`(또는 `HEIRLOOM_HOME`): 작업, 승인, 키, 서버 상태. 로컬에만 둡니다.

→ [데이터 위치](docs/guide/ko/data.md)

## 설정

설정은 선택입니다. [`examples/`](examples/)의 예시를 복사해 필요한 값만 바꾸세요. 포트, 유휴 시간, 브라우저 자동 열기, 대상 브랜치, spec 경로 등을 바꿀 수 있습니다.

→ [설정 가이드](docs/guide/ko/configuration.md)

## 보안

승인에는 사용자별 ed25519 키로 서명합니다. 대시보드는 `127.0.0.1`에서만 열리고 Host, Origin, 세션 토큰을 검사합니다. 그래도 같은 OS 사용자 권한의 에이전트가 의도적으로 우회하는 것은 막지 못합니다. Heirloom의 목표는 차단이 아니라 탐지와 감사입니다.

→ [보안 모델과 한계](docs/guide/ko/security.md)

## 지원 예정

다음 기능을 지원할 예정입니다.

- Codex·Antigravity 호스트
- Windows 키체인

→ [지원 예정](docs/guide/ko/roadmap.md)

## 라이선스

Heirloom은 [Apache License 2.0](LICENSE)으로 배포합니다.

대시보드에는 고정 버전의 [SEED Design](https://github.com/daangn/seed-design) CSS(Apache-2.0)가 들어 있습니다. `LICENSE`와 `NOTICE`는 `skills/using-heirloom/dashboard/vendor/seed-design/`에 있습니다.
