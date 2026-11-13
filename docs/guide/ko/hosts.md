# 호스트

[English](../en/hosts.md)

Heirloom은 Claude Code, Codex, Antigravity에서 동작합니다. 인계, 대시보드, 승인, 기록은 세 호스트에서 같습니다. 다른 것은 호스트가 플러그인을 불러오는 방식, 세션 시작 때 규약을 주입하는 방식, 종료 때 상기하는 방식입니다.

## 지원 등급

등급은 연결 중 무엇이 동작하는지를 나타냅니다. **A**는 규약 주입(시작과 압축 뒤)과 종료 시 상기가 모두 동작, **B**는 규약 주입만 동작, **C**는 수동 인계만 가능합니다.

| 호스트 | 등급 | 확인한 버전 | 조건과 한계 |
| --- | --- | --- | --- |
| Claude Code | A | Claude Code 2.1 | — |
| Codex | A (잠정) | Codex CLI 0.167.0 | `/hooks`에서 훅을 신뢰해야 훅이 실행됩니다. Codex 기본 샌드박스에서는 에이전트의 명령으로 대시보드를 띄우지 못할 수 있으니 직접 엽니다(아래). |
| Antigravity | A (잠정) | Antigravity CLI(`agy`) 1.5.7 | 압축 훅이 없습니다. 압축 뒤 규약은 다시 주입되지 않고, 상시 규칙(`rules/heirloom.md`)과 압축 요약으로 유지됩니다. |

'잠정': 등급은 짧은 헤드리스 실행 묶음(정상 완료, 중간 보고, 질문, 중단, 이어서 하기)으로 정했습니다. 오류 종료와 다른 SDLC 도구와의 긴 작업은 누락률·오호출률을 낼 만큼 반복하지 않았습니다. 겪은 일을 [피드백 양식](https://github.com/cheongfish/heirloom/issues/new?template=feedback.yml)으로 알려 주세요.

## 설치

플러그인 파일만 담은 `release` 브랜치에서 설치합니다.

### Claude Code

```text
/plugin marketplace add cheongfish/heirloom#release
/plugin install heirloom@heirloom
```

업데이트: `/plugin marketplace update heirloom`.

### Codex

```sh
codex plugin marketplace add cheongfish/heirloom@release
codex plugin add heirloom@heirloom
```

그다음 Codex 세션에서 `/hooks`를 열고 Heirloom 훅 두 개(SessionStart, Stop)를 신뢰합니다. 그 전에는 수동 인계만 됩니다. 업데이트: `codex plugin marketplace upgrade heirloom`. 업데이트 뒤 상기나 주입이 멈추면 `/hooks`를 다시 확인합니다.

### Antigravity

`release` 브랜치를 내려받고 그 폴더에서 플러그인을 설치합니다.

```sh
git clone -b release https://github.com/cheongfish/heirloom ~/tools/heirloom
agy plugin install ~/tools/heirloom
```

업데이트: `git -C ~/tools/heirloom pull` 뒤 `agy plugin install ~/tools/heirloom`을 다시 실행합니다. `agy plugin import claude`로 Claude Code 설치본을 함께 가져오지 마세요. 변환된 훅이 Heirloom 자체 훅과 나란히 실행됩니다.

## 스킬 호출

에이전트가 스킬을 알아서 호출합니다. 직접 호출하려면:

| 호스트 | 예 |
| --- | --- |
| Claude Code | `/prepare-handoff` |
| Codex | `$prepare-handoff` |
| Antigravity | `/prepare-handoff` |

## 호스트별 차이

| 항목 | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| 훅 파일 | `hooks/hooks.json` | `hooks/hooks.json` (Claude Code와 공유) | 플러그인 루트의 `hooks.json` |
| 압축 뒤 | 규약을 다시 주입 | 규약을 다시 주입 | 상시 규칙과 압축 요약 |
| 세션이 읽은 spec을 연결로 보는 기준(종료 상기) | Read 도구 호출 | spec 파일을 가리키는 셸 명령 | `read_file` 호출과 셸 명령 |
| 중단 뒤 종료 훅 | 실행되지 않음 | 실행되지 않음(이른 중단에서 확인) | 실행되지만 Heirloom은 정상 종료에서만 상기 |
| 저장소 ID | `.git` | 샌드박스가 `.git`을 읽기 전용으로 두면 `~/.heirloom/ids/` | `.git` |
| 헤드리스 맥락 정리 | 허용 도구를 준 `claude -p` | 실행별 허용 목록 훅을 준 `codex exec`([보안](security.md#헤드리스-정리-실행)) | 실행별 권한 규칙을 준 `agy -p` |

### Codex에서 대시보드 열기

Codex 기본 샌드박스는 네트워크를 막아, 에이전트의 인계가 대시보드를 띄우거나 접속하지 못합니다. 인계는 그대로 저장되고 에이전트가 대시보드 오류를 알립니다. Codex 밖의 터미널에서 대시보드를 엽니다.

```sh
node ~/.codex/plugins/cache/heirloom/heirloom/<버전>/skills/using-heirloom/scripts/open-dashboard.mjs
```

### Codex 신뢰 항목

`codex exec`은 실행한 디렉터리를 `~/.codex/config.toml`에 신뢰 항목(`[projects."<경로>"] trust_level = "trusted"`)으로 남깁니다. 헤드리스 정리도 마찬가지라, 정리할 때마다 `~/.heirloom/worktrees/` 아래 worktree의 항목이 하나씩 남습니다. Heirloom은 사용자의 Codex 설정을 고치지 않으니, 필요하면 오래된 항목을 직접 지웁니다.
