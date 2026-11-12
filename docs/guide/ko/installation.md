# 설치

[English](../en/installation.md)

## 요구 사항

| 항목 | 필요 조건 |
| --- | --- |
| Node.js | 20 이상. Heirloom은 Node 내장 모듈만 쓰므로 `npm install`이 필요 없습니다. |
| git | 소비 프로젝트가 git 저장소여야 합니다. 대상 브랜치는 `origin/HEAD` 또는 프로젝트 설정의 `baseBranch`로 정합니다. |
| Claude Code | 현재 지원하는 유일한 호스트입니다. |
| `gh` (선택) | PR을 만들 때만 필요합니다. 원격이 github.com이어야 하고 `gh auth login`이 되어 있어야 합니다. 없으면 기록 파일까지만 쓰고 PR은 직접 만들게 됩니다. |
| 운영체제 | Linux, macOS, WSL. Windows 키체인은 아직 쓰지 않습니다(파일로 보관). |

Node를 찾지 못하거나 버전이 20 미만이면 Heirloom은 세션을 막지 않습니다. 세션 시작 때 "Heirloom 비활성: Node 20 이상이 필요합니다."라는 한 줄만 보이고 나머지 기능은 꺼집니다.

## 설치

먼저 저장소를 내려받습니다.

```sh
git clone <heirloom 저장소 URL> ~/tools/heirloom
```

### 마켓플레이스로 설치

저장소 자체가 플러그인 마켓플레이스입니다(`.claude-plugin/marketplace.json`). 한 번 추가하고 플러그인을 설치하면 모든 세션에서 불러옵니다.

```text
/plugin marketplace add ~/tools/heirloom
/plugin install heirloom@heirloom
```

저장소에서 `git pull`한 뒤에는 `/plugin marketplace update heirloom`으로 새 버전을 반영합니다.

### 한 세션에서만 쓰기

저장소를 플러그인 디렉터리로 지정해 Claude Code를 실행합니다. 따로 설치되지는 않습니다.

```sh
cd <작업할 프로젝트>
claude --plugin-dir ~/tools/heirloom
```

## 설치 확인

1. 위 명령으로 세션을 시작합니다.
2. 에이전트에게 "Heirloom 규약이 보이니?"처럼 물어봅니다. 세션 시작 때 주입된 `<heirloom-convention>`과 `<heirloom-project>` 블록을 확인할 수 있습니다.
3. 대시보드가 뜨는지 보려면 에이전트에게 "Heirloom 대시보드 열어줘"라고 요청합니다. 브라우저에 `http://127.0.0.1:17380/`이 열립니다.

## 다음 단계

- [작업 흐름](workflow.md)
- [설정](configuration.md)
