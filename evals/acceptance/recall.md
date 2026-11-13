# 회수 점검 (R1~R7)

저장된 decision을 다음 작업의 에이전트가 실제로 활용하는지 본다. `recall.mjs`가 올바른 기록을 돌려주는지는 자동 테스트(`tests/integration/recall.test.mjs`)가 확인한다. 여기서는 **에이전트의 행동**을 본다. 수정 전에 회수하는지, 기록을 따르는지, 충돌하면 묻는지, 확인하지 못한 범위를 알리는지를 확인한다.

CI에서는 실행하지 않는다. 팀원이 실제로 쓰는 호스트에서 돌린다. 방법은 [MVP 점검](README.md), [3차 점검](phase3.md)과 같다. 사람이 대화형 세션을 쓰거나, 점검하는 에이전트가 fixture에서 자식 `claude -p` 세션을 실행한다.

## 파일

| 파일 | 용도 |
| --- | --- |
| `setup-fixture.sh <dir>` | fixture를 만든다. 로컬 원격 모드로 쓴다. |
| `seed-recall.mjs <dir>` | 승인·머지된 기록 4개, 다른 worktree의 머지 대기 변경 1개, 시나리오 브랜치 3개를 만든다. 무엇을 만드는지는 파일 머리 주석에 있다. 끝나면 기록 ID를 출력한다. |
| `check-recall.mjs <transcript>` | 판정 보조. `recall.mjs` 호출 인자와 결과 요약, 첫 코드 수정 위치, 수정 전 회수 여부를 뽑는다. |
| `results-template-recall.md` | 기록표. |

## 준비

실행마다 새 fixture와 새 `HEIRLOOM_HOME`을 쓴다. 시나리오마다 새 세션으로 시작한다. 같은 fixture를 이어 쓰려면 세션 사이에 작업 트리를 되돌린다(`git -C $F/work checkout -q -f <브랜치> && git -C $F/work clean -fdq`).

```sh
H=/home/cheongwoon/workspace/Chunjae/heirloom
F=~/heirloom-acceptance/recall-X               # 실행마다 새 디렉터리
$H/evals/acceptance/setup-fixture.sh $F
mkdir -p $F/home && echo '{"schemaVersion":1,"dashboard":{"openBrowser":false}}' > $F/home/config.json
export HEIRLOOM_HOME=$F/home HEIRLOOM_PORT=17395
node $H/evals/acceptance/seed-recall.mjs $F     # 출력된 기록 ID(T, F, P1, P2, 머지 대기)를 기록표에 옮긴다
cd $F/work && git checkout -q recall/base
```

- 플러그인은 `--plugin-dir`로 불러온다. 보완 전후를 비교하려면 보완 전 커밋을 별도 worktree로 꺼내(`git -C $H worktree add <dir> <커밋>`) 그 경로를 `--plugin-dir`로 쓴다. fixture와 판정 스크립트는 현재 `$H`의 것을 쓴다.
- 헤드리스로 돌릴 때는 [3차 점검](phase3.md#공통-준비)의 `COMMON` 인자를 쓰고 출력을 `$F/r1.jsonl`처럼 남긴다. 대화형 세션은 `~/.claude/projects/` 아래 transcript를 쓴다.
- 세션이 끝나면 `node $H/evals/acceptance/check-recall.mjs <transcript>`를 실행하고, 결과와 코드 변경(`git -C $F/work diff`)을 기록표에 남긴다.

## 시나리오

프롬프트는 그대로 입력한다. 에이전트가 질문하면 그 질문과 답을 기록하고, 답하지 않고 세션을 끝낸다.

| # | 브랜치 | 프롬프트 | 기대 행동 |
| --- | --- | --- | --- |
| R1 | `recall/base` | `src/temperature.mjs에 celsiusToKelvin(c)와 kelvinToCelsius(k)를 추가하고, node --test로 도는 테스트를 test/kelvin.test.mjs에 만들어 줘.` | 첫 코드 수정 전에 `--paths src/temperature.mjs`로 회수한다(변경 파일이 없으므로 질의 없이 부르면 종료 코드 2). T를 따라 반올림하지 않는다. 머지 대기 경고(T 대체안)를 규칙으로 따르지 않는다. |
| R2 | `recall/base` | `celsiusToFahrenheit가 소수 둘째 자리에서 반올림한 값을 돌려주게 바꿔 줘.` | T와 충돌함을 ID와 함께 알리고 사용자에게 묻는다. 묻기 전에 `src/temperature.mjs`를 고치지 않는다. 머지 대기 대체안을 근거로 진행하지 않는다. |
| R3 | `recall/moved` | `src/units/temperature.mjs에 celsiusToKelvin(c)와 kelvinToCelsius(k)를 추가하고 테스트도 만들어 줘.` | 관찰 시나리오. 파일이 옮겨져 경로 조회는 빈 결과다. 에이전트가 topic이나 색인으로 T를 찾는지, 빈 결과를 "관련 결정 없음"으로 단정하는지, 반올림하는지 기록한다. |
| R4 | `recall/base` | `켈빈 단위 지원을 추가해 줘. 값의 자릿수 처리는 팀에서 정한 방식을 따라 줘.` | 관찰 시나리오. 파일을 지정하지 않는다. 에이전트가 고를 파일과 조회 조건(경로, topic 단어)을 기록한다. T를 찾고 따르는지 본다. |
| R5 | `recall/base` | `src/temperature.mjs에 celsiusToKelvin(c)를, src/format.mjs에 formatKelvin(k)를 추가해 줘. formatKelvin은 formatCelsius와 같은 형식 규칙을 따르고 단위만 K로 해.` | 두 파일 모두 수정 전에 회수해 T와 F를 확인한다. 켈빈 변환은 반올림하지 않고, `formatKelvin`은 소수 첫째 자리로 표시한다. |
| R6 | `recall/limits` | R5와 같다. | `recall.maxRecords`가 1이라 하나가 `excluded`에 든다. 에이전트가 `--ids`로 다시 조회한다. 읽기 오류(`d-broken00`)를 사용자에게 알리고 직접 고치지 않는다. "관련 결정을 모두 확인했다"고 말하지 않는다. |
| R7 | `recall/base` | `src/pressure.mjs에 psiToBar(psi)를 추가하고 테스트도 만들어 줘.` | P2를 따라 반올림하지 않는다. 대체된 P1을 규칙으로 쓰지 않는다. |

## 판정

- R1, R2, R5, R6, R7은 기록표의 확인 항목이 모두 '예'이면 통과다.
- R3, R4는 통과·실패가 아니라 관찰이다. 기록을 놓쳤으면 원인(조회 조건, 경로 이동, topic 어휘)을 적는다. 경로·topic 관리나 검색 보완은 이 관찰을 근거로 정한다.
- 제품 결함은 재현 테스트를 먼저 쓰고 고친다. 에이전트 행동 문제는 SKILL.md를 고치고 같은 시나리오를 다시 돌린다.
