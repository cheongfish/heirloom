# Codex 인계 호출 평가

PLAN 7.5절의 호스트 등급과 PLAN 18절의 누락률·오호출률을 Codex CLI에서 측정한다. 시나리오는 [`../claude-code/README.md`](../claude-code/README.md)의 S1~S6에 호스트 차이에서 나온 S0·S7~S10을 더한 것이다. 헤드리스 시나리오는 [`../hosts/run.mjs`](../hosts/README.md)로 돌리고, S4·S6은 사람이 대화형으로 진행한다. CI에서는 실행하지 않는다.

## 측정 대상

| 항목 | 정의 |
| --- | --- |
| 인계 호출 | `HEIRLOOM_HOME`에 작업이 생김(`prepare-handoff`의 `prepare.mjs` 실행) |
| 누락 | 인계해야 하는 시나리오에서 실행이 끝날 때까지 작업이 없음 |
| 오호출 | 인계하면 안 되는 시나리오에서 작업이 생김, 또는 같은 상태에 작업이 둘 이상 |
| 규약 주입 | 훅 로그의 `session-start`가 `additionalContext`를 출력함 |
| Stop 상기 | 훅 로그의 `stop`이 `decision: "block"`을 출력함 |

## Codex에서 다른 점

- 플러그인 훅은 사용자가 `/hooks`에서 신뢰해야 실행된다. 헤드리스 실행은 `--dangerously-bypass-hook-trust`로 이 절차를 건너뛴다. 대화형 시나리오는 처음 한 번 `/hooks`에서 Heirloom 훅을 신뢰한다.
- 훅 파일은 Claude Code와 같은 `hooks/hooks.json`이다. SessionStart의 `source`로 시작(`startup`)과 압축 뒤(`compact`)를 구분한다.
- 세션을 이어서 하려면 `codex exec resume <세션 ID>`(헤드리스) 또는 `codex resume`(대화형)을 쓴다.

## 시나리오

| # | 시나리오 | 진행 | 기대 결과 |
| --- | --- | --- | --- |
| S0 | 설치와 주입 | `run.mjs --scenario S0` | 규약 문장을 근거로 답함. 인계 없음 |
| S1 | 정상 완료 | `run.mjs --scenario S1` | 완료 보고 전에 인계 1회 |
| S2 | 중간 보고 | `run.mjs --scenario S2` | 인계 없음. 상기가 나오면 인계하지 않고 종료 |
| S3 | 질문 대기 | `run.mjs --scenario S3` | 질문하고 멈춤. 인계 없음 |
| S4 | 사용자 중단 | 대화형: S1 프롬프트를 입력하고 파일 수정이 시작되면 `Esc` | 인계 없음. 재개하지 않음 |
| S5 | 오류 종료 | `run.mjs --scenario S5` (test 스크립트가 `exit 1`, 프롬프트에 "package.json은 고치지 말고 npm test로 확인") | 실패를 보고함. 인계 없음 |
| S6 | 압축 뒤 완료 | 대화형: S1을 진행하다 구현 도중 `/compact`, 이어서 끝까지 | 압축 뒤 규약 재주입(`source: compact`), 완료 전 인계 1회 |
| S7 | 상기만으로 인계 | `run.mjs --scenario S7` (세션 시작 주입 끔) | Stop 상기 뒤 인계 1회 |
| S8 | 인계 뒤 종료 | `run.mjs --scenario S8` (S1 뒤 같은 세션에서 "마무리하자") | 두 번째 단계에서 새 인계·상기 없음 |
| S9 | 다른 SDLC와 긴 작업 | `run.mjs --scenario S9` (Superpowers를 켬) | 완료 전 인계 1회 |
| S10 | 이어서 하기 | `run.mjs --scenario S10` (S2 뒤 같은 세션에서 나머지 완료) | 이어진 단계에서 인계 1회 |

대화형 시나리오의 준비:

```sh
H=<heirloom 저장소 경로>; F=<빈 디렉터리>
$H/evals/claude-code/setup-fixture.sh $F/fx && mkdir -p $F/home
echo '{"schemaVersion":1,"dashboard":{"openBrowser":false}}' > $F/home/config.json
cd $F/fx/work && HEIRLOOM_HOME=$F/home HEIRLOOM_PORT=17391 HEIRLOOM_HOOK_LOG=1 codex
```

## 기록

실행마다 `results-template.md`의 표 한 줄을 채운다. 한 번의 실험 묶음은 `results/<날짜>-step1.md` 하나에 모은다. 판정은 `result.json`의 자동 판정을 출발점으로, 마지막 메시지를 읽고 확정한다.
