# testCadence 점검

프로젝트 설정 `testCadence.mode: "phase"`가 개발 도구(Superpowers)의 테스트 주기를 실제로 바꾸는지 확인한다. 같은 spec을 두 fixture에서 돌려 비교한다. 기준선은 설정이 없는 `off`, 비교군은 `phase`다. CI에서는 실행하지 않는다.

## 파일

| 파일 | 용도 |
| --- | --- |
| `setup-fixture.sh <dir> off\|phase` | 기존 테스트가 있는 작은 저장소와 spec 하나를 만든다. `phase`면 main에 `.heirloom/config.json`을 둔다. |
| `count-test-runs.mjs <transcript.jsonl>` | 메인 세션과 하위 에이전트 transcript에서 테스트 실행을 시간순으로 뽑아, 전체 테스트와 대상 테스트로 나눠 센다. |

## 실행

```sh
H=<heirloom 저장소 경로>
SP=~/.claude/plugins/cache/superpowers-marketplace/superpowers/<버전>
for m in off phase; do
  F=~/heirloom-acceptance/cadence-$m
  $H/evals/test-cadence/setup-fixture.sh $F $m
  mkdir -p $F/home && echo '{"schemaVersion":1,"dashboard":{"openBrowser":false}}' > $F/home/config.json
done
# 각 fixture에서 (HEIRLOOM_HOME=$F/home, 포트는 서로 다르게):
cd $F/work && claude -p "docs/superpowers/specs/2026-11-13-units.md를 구현해 줘. superpowers:writing-plans로 구현 계획을 쓰고, 실행 방식은 Subagent-driven으로 정했으니 계획 검토는 기다리지 말고 바로 superpowers:subagent-driven-development로 끝까지 구현해 줘. 지금 브랜치 feat/units에서 작업하고 worktree는 따로 만들지 마. 질문이 생기면 합리적으로 판단해서 진행하고, 판단한 내용은 마지막에 알려 줘." \
  --model sonnet --max-budget-usd 15 --plugin-dir $SP --plugin-dir $H --add-dir $F/home --add-dir /tmp \
  --permission-mode acceptEdits --allowedTools "Bash(node *)" "Bash(git *)" "Bash(npm *)" "Bash(bash *)" "Bash(mktemp *)" "Bash(ls *)" "Bash(cat *)" "Bash(cd *)" \
  --output-format stream-json --verbose > $F/run.jsonl
```

세션은 끝에 Heirloom 인계를 하고 승인을 기다리므로, 작업이 `awaiting_approval`이 되면 끝낸다.

## 판정

```sh
node $H/evals/test-cadence/count-test-runs.mjs ~/.claude/projects/<fixture 경로>/<세션 ID>.jsonl
```

- 계획: `phase`에서는 task가 phase로 묶이고, task의 실행 줄은 대상 테스트만이며, phase마다 전체 테스트 관문이 있다.
- 구현: `phase`에서 task 구현자·리뷰어 하위 에이전트가 전체 테스트를 돌리지 않는다. 전체 테스트는 phase 관문, 최종 리뷰, 인계 전에만 돈다.
- 하위 에이전트 지시문(transcript 첫 메시지)에 테스트 주기 규칙이 옮겨져 있다.
- 두 fixture 모두 최종 전체 테스트가 통과한다.
