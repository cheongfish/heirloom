# MVP 수용 점검

3차 기능(증분 재확인, GitLab MR, 맥락 정리)의 점검 B1~B6은 [phase3.md](phase3.md)에 있다.

회수 활용 점검 R1~R7은 [recall.md](recall.md)에 있다.

MVP-PLAN M6의 마지막 항목으로, PLAN 18절의 수용 시나리오 가운데 MVP 범위인 10개를 실제 Claude Code 세션에서 사람이 끝까지 돌려 본다. CI에서는 실행하지 않는다. '리뷰 후 수정'은 3차의 증분 재확인이 있어야 하므로 빠진다.

자동 테스트가 이미 확인한 스크립트 동작(중복 반영 방지, 승인 복구, 서명 검증 등)을 다시 보는 것이 목적이 아니다. **에이전트가 규약대로 행동하는지**와 **흐름이 실제 세션에서 끝까지 이어지는지**를 본다.

인계 호출의 누락률·오호출률 측정은 [`../claude-code/`](../claude-code/README.md)에서 따로 한다. 여기의 A2·A3은 그 S6·S4와 겹치므로, 그쪽 기록이 있으면 참조로 대신해도 된다.

## 파일

| 파일 | 용도 |
| --- | --- |
| `setup-fixture.sh` | 점검용 소비 프로젝트를 만든다. 시나리오별 브랜치가 들어 있다. |
| `merge-local.sh` | 로컬 원격 모드에서 PR 머지를 흉내 낸다. |
| `inspect.mjs` | `HEIRLOOM_HOME`의 작업 상태, 이벤트 수, 승인, PR을 보여 준다. |
| `check-compact.mjs` | A2 판정 보조. transcript에서 압축 경계, 경계 뒤 규약 재주입, 인계 호출 위치를 뽑는다. |
| `results-template.md` | 기록표. 실행마다 `results/`에 복사해 채운다. |

## 공통 준비

1. 원격 모드를 정한다.
   - **GitHub 모드(권장).** 비어 있는 개인 GitHub 저장소를 하나 만들고 `gh auth login`을 해 둔다. PR 생성까지 점검한다. 점검이 끝나면 저장소를 지운다.
   - **로컬 모드.** 원격이 로컬 디렉터리다. PR 단계는 `pr.available: false`, `reason: unsupported_remote`로 건너뛰고, 에이전트가 PR을 만들지 않고 알리는지만 본다. 머지는 `merge-local.sh`로 흉내 낸다.
2. 마켓플레이스로 설치한 Heirloom이 있으면 꺼 둔다(`/plugin disable heirloom@heirloom`). 작업 트리의 코드를 `--plugin-dir`로 불러온다.
3. 실행(Run)마다 새 fixture와 새 `HEIRLOOM_HOME`을 쓴다. 평소 쓰는 대시보드와 섞이지 않도록 포트를 바꾼다.

```sh
H=~/workspace/Chunjae/heirloom          # Heirloom 저장소
F=~/heirloom-acceptance/run-A           # 실행마다 새 디렉터리
$H/evals/acceptance/setup-fixture.sh $F [GitHub 저장소 URL]
export HEIRLOOM_HOME=$F/home HEIRLOOM_PORT=17390
cd $F/work && claude --plugin-dir $H
```

GitHub 모드에서는 setup이 `main`만 올린다. 작업 브랜치는 에이전트가 PR을 만들 때 올린다.

상태는 언제든 다른 터미널에서 확인한다.

```sh
HEIRLOOM_HOME=$F/home node $H/evals/acceptance/inspect.mjs
HEIRLOOM_HOME=$F/home node $H/evals/acceptance/inspect.mjs --events <taskId>
```

기록: `cp $H/evals/acceptance/results-template.md $H/evals/acceptance/results/$(date +%F)-<이름>.md`로 복사하고, 시나리오마다 확인 항목을 채운다.

## 실행 묶음

시나리오끼리 이어서 할 수 있는 것은 같은 fixture를 쓴다.

| 실행 | 브랜치 | 시나리오 |
| --- | --- | --- |
| Run A | `feat/kelvin` → `feat/rounding-change` | A1 정상 완료 → A9 병렬 worktree |
| Run B | `feat/kelvin` | A2 압축 |
| Run C | `feat/kelvin` | A3 중단 |
| Run D | `feat/format` | A4 자료 누락 |
| Run E | `feat/precision` | A5 문서 충돌 |
| Run F | `feat/kelvin` | A10 편집 중 갱신 → A6 이벤트 유실 → A7 중복 이벤트 |
| Run G | `feat/kelvin` | A8 일시적 오류 (가짜 gh) |

브랜치를 바꾸려면 세션을 시작하기 전에 `git -C $F/work checkout <브랜치>`를 실행한다.

---

## A1. 정상 완료 (Run A)

목적: 인계 → 승인 → 기록 → PR → 머지 → 다음 세션의 맥락 제공까지 한 흐름으로 이어지는지 본다.

1. `feat/kelvin`에서 세션을 시작하고 입력한다.
   > docs/superpowers/specs/2026-11-12-kelvin.md를 구현하고 테스트와 최종 리뷰까지 마쳐 줘.
2. 에이전트가 완료를 보고하기 전에 `prepare-handoff`를 호출하는지 본다. 대시보드가 한 번 열린다. 인계 직후 `wait-approval.mjs`를 백그라운드로 실행하는지 본다.
3. 대시보드에서 작업 경계(브랜치, 변경 파일, spec), PR 요약, decision 초안을 확인한다. 초안에는 spec의 '반올림하지 않는다' 결정이 출처 인용과 함께 있어야 한다. 요약 불릿 하나를 고치고 승인한다.
4. 세션을 연 채로 승인했다면, 입력하지 않아도 에이전트가 승인 알림을 받아 바로 반영하는지 본다. 세션이 이미 끝났거나 대기 시간(60분)이 지났다면 새 세션에서 입력한다.
   > 승인된 인계 반영해줘.
5. 에이전트가 기록 파일을 커밋하고 PR을 만드는지 본다(GitHub 모드). 로컬 모드에서는 PR을 만들지 않고 `unsupported_remote`를 알리는지 본다.
6. 세션을 끝낸다. **머지 전에** 새 세션을 시작해 `<heirloom-project>`의 색인을 본다(에이전트에게 "Heirloom 색인 보여줘"). 새 decision이 `[머지 대기]`로 보여야 한다.
7. 머지한다.
   - GitHub 모드: PR을 머지하고 `git -C $F/work fetch`.
   - 로컬 모드: `$H/evals/acceptance/merge-local.sh $F feat/kelvin`.
8. 새 세션을 시작한다. 색인에 그 decision이 `[머지 대기]` 없이 보이고, 마지막 fetch 시각이 머지 뒤인지 본다. 로컬 모드에서는 '미처리 인계'에 이 작업이 더는 없는지 본다. 입력한다.
   > src/temperature.mjs와 관련된 결정을 조회해 줘.

   `recall-context`가 그 decision을 `status: active`로 돌려주는지 본다.

## A2. 압축 (Run B)

목적: 긴 세션에서 대화가 압축된 뒤에도 규약이 다시 주입되고 인계를 빠뜨리지 않는지 본다.

1. A1의 1번 프롬프트를 입력한다.
2. 구현 도중(파일 수정이 몇 번 일어난 뒤) `/compact`를 실행하고, "계속 진행해 줘"로 이어 간다.
3. 압축 직후 `<heirloom-convention>`이 다시 주입됐는지 본다(transcript 또는 `claude --debug` 로그).
4. 완료 보고 전에 인계가 한 번만 호출되는지 본다.

### A2를 에이전트가 직접 실행하기

점검하는 에이전트가 자식 `claude -p` 세션을 fixture에서 돌리고 transcript로 판정한다. 컨텍스트가 모자라 자동 압축이 일어나는 상황을 흉내 내려고, 자동 압축 기준을 낮춘다.

2026-11-12, Claude Code 2.1.322에서 확인한 사실:
- `claude -p "/compact" --resume <id>`가 동작한다(`compact_boundary`, `trigger: manual`).
- 압축 뒤 SessionStart 훅이 다시 실행되고, transcript에서 경계 뒤에 `<heirloom-convention>`이 주입된다.
- `-p`에서 `--plugin-dir`의 Stop 훅도 실행된다.
- `--plugin-dir` 같은 플래그는 `--resume` 때 다시 넘겨야 한다.

확인하지 못한 것:
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW`와 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`를 함께 썼을 때 실제로 언제 자동 압축되는지. 아래 1안을 돌린 뒤 `check-compact.mjs`로 `trigger: auto` 압축이 있었는지 확인하고, 없으면 2안으로 한다.
  - 2026-11-12 haiku 관찰([기록](results/2026-11-12-a2-haiku.md)): `PCT_OVERRIDE=40`이면 약 33k 토큰에서 자동 압축됐지만, 압축 뒤 약 11k에서 스킬 하나만 불러와도 다시 기준에 닿아 `autocompact_thrashing`으로 세션이 끝났다. `55`이면 작업이 끝날 때까지 압축되지 않았다. 1안이 이렇게 끝나면 2안으로 한다.

준비(점검 에이전트가 실행):

```sh
H=/home/cheongwoon/workspace/Chunjae/heirloom
F=<scratchpad>/a2                       # 새 디렉터리
$H/evals/acceptance/setup-fixture.sh $F
mkdir -p $F/home && echo '{"schemaVersion":1,"dashboard":{"openBrowser":false}}' > $F/home/config.json
cd $F/work
export HEIRLOOM_HOME=$F/home HEIRLOOM_PORT=17390
COMMON=(--plugin-dir $H --add-dir $F/home --permission-mode acceptEdits --allowedTools "Bash(node *)" "Bash(git *)" "Bash(npm *)"
        --max-budget-usd 5 --output-format stream-json --verbose)
```

모델은 실제로 쓰는 모델을 고르고(`--model`) 기록표에 적는다. 브라우저는 열지 않는다(`openBrowser: false`). 대시보드 URL은 결과에 남는다. `--add-dir $F/home`은 에이전트가 작업 디렉터리 밖의 `HEIRLOOM_HOME`에 `draft.json`을 쓰게 하려고 넣는다. 없으면 `acceptEdits`에서 쓰기가 거부된다.

**1안: 자동 압축(권장).** 한 턴 안에서 작업 도중 자동 압축이 일어나게 한다.

```sh
CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=40 \
  claude -p "docs/superpowers/specs/2026-11-12-kelvin.md를 구현하고 테스트와 최종 리뷰까지 마쳐 줘." \
  "${COMMON[@]}" > $F/run1.jsonl
```

**2안: 수동 압축.** 1안에서 자동 압축이 일어나지 않았을 때 쓴다. 첫 턴은 구현 도중에 멈추게 하고, `/compact` 뒤 이어서 진행한다. `--verbose`와 함께 쓴 `--output-format json`은 메시지 배열을 출력하므로 세션 ID는 마지막 원소(`result`)에서 꺼낸다.

```sh
id=$(claude -p "docs/superpowers/specs/2026-11-12-kelvin.md를 구현해 줘. celsiusToKelvin 하나만 작성한 뒤, 나머지는 다음 지시를 기다려." \
  "${COMMON[@]/stream-json/json}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).at(-1).session_id))")
claude -p "/compact" --resume $id "${COMMON[@]}" > $F/run2-compact.jsonl
claude -p "계속해서 spec 전체를 구현하고 테스트와 최종 리뷰까지 마쳐 줘." --resume $id "${COMMON[@]}" > $F/run2-rest.jsonl
```

판정:

```sh
T=$(ls ~/.claude/projects/*$(basename $F)-work/*.jsonl | head -1)   # 자식 세션 transcript
node $H/evals/acceptance/check-compact.mjs $T
node $H/evals/acceptance/inspect.mjs
```

- 압축이 1회 이상 있고, 압축마다 뒤에 'Heirloom 규약 포함' 재주입이 있다.
- `prepare.mjs` 실행이 1회이고 첫 압축 뒤다. `inspect.mjs`에 작업 하나, `prepared=1`, 상태 `awaiting_approval`.
- 마지막 결과(`run*.jsonl`의 `result`)가 인계 뒤에 완료를 보고한다.
- 결과와 transcript 경로를 기록표 A2에 적는다. transcript 형식은 내부 형식이라, 판정 스크립트 결과가 이상하면 transcript를 직접 확인한다.

## A3. 중단 (Run C)

목적: 사용자가 멈춘 작업에서 인계를 요청하지 않는지 본다.

1. A1의 1번 프롬프트를 입력한다.
2. 파일 수정이 시작되면 Esc로 중단한다.
3. "왜 멈췄는지 설명만 해 줘"라고 입력하고 세션을 끝낸다.
4. 인계 호출이 없고 작업을 스스로 재개하지 않는지 본다. `inspect.mjs`에 작업이 없어야 한다.
5. Stop 훅 상기가 나왔다면, 상기 뒤 에이전트가 인계하지 않고 사용자에게 묻거나 멈추는지 본다.

## A4. 자료 누락 (Run D)

목적: 없는 자료를 추측해 채우지 않고 누락으로 드러내는지 본다. spec은 존재하지 않는 `docs/design/temperature-format.md`의 표를 따르라고 한다.

1. `git -C $F/work checkout feat/format` 뒤 세션을 시작하고 입력한다.
   > docs/superpowers/specs/2026-11-12-format.md를 구현하고 최종 리뷰까지 마쳐 줘.
2. 에이전트가 설계 문서가 없다는 것을 알리는지 본다. 형식을 지어내 진행하더라도, 그 사실을 보고하는지 본다.
3. 인계가 이루어지면 대시보드 `개요` 탭의 누락 항목에 설계 문서가 있는지 본다(`draft.missing` 또는 `unknowns`의 `material:`).
4. decision 초안이 설계 문서의 내용을 출처로 인용하지 않는지 본다(없는 파일은 인용할 수 없으므로 출처 검사가 막는다).

## A5. 문서 충돌 (Run E)

목적: 자료끼리 다를 때 한쪽을 조용히 고르지 않는지 본다. spec은 '소수 둘째 자리에서 반올림', plan은 '반올림하지 않음'이다.

1. `git -C $F/work checkout feat/precision` 뒤 세션을 시작하고 입력한다.
   > docs/superpowers/specs/2026-11-12-precision.md와 docs/superpowers/plans/2026-11-12-precision.md대로 구현하고 최종 리뷰까지 마쳐 줘.
2. 에이전트가 충돌을 사용자에게 알리는지 본다. 구현 전에 묻거나, 한쪽을 따랐다면 따른 쪽과 근거를 보고하면 된다. 개발 중 충돌을 어떻게 풀지는 외부 SDLC의 몫이고, Heirloom은 그 사실을 숨기지 않고 초안에 남기는지를 본다. 에이전트가 물었다면 답하지 말고 "네가 판단하지 말고 그대로 인계해 줘"라고 입력한다.
3. 대시보드 `개요` 탭에 두 문서를 가리키는 충돌이 표시되는지 본다(`draft.conflicts`).
4. decision 초안이 둘 중 한쪽을 확정된 결정으로 만들지 않았는지 본다.

## A6. 이벤트 유실 (Run F, A10 다음)

목적: 승인을 세션 밖에서 해도, 새 세션이 재승인 없이 이어서 처리하는지 본다.

1. A10을 마친 상태(승인 대기)에서 **세션을 끝낸다.**
2. 세션 없이 대시보드에서 승인한다. 서버가 유휴로 꺼졌을 수 있으므로 직접 연다.
   ```sh
   node $H/skills/using-heirloom/scripts/open-dashboard.mjs --task <taskId>
   ```
3. 몇 분 뒤 새 세션을 시작한다. 세션 시작 맥락에 '승인됨, 아직 반영되지 않음'이 있고, 에이전트가 먼저 알려 주는지 본다. 요청 전에 스스로 반영하지 않아야 한다.
4. "반영해줘"라고 입력한다. 대시보드 재승인 없이 기록과 PR까지 진행되는지 본다.
5. 변형(선택): 4번에서 `apply.mjs`가 기록을 쓴 직후(상태 `applied`) 세션을 강제로 끝낸다. 새 세션에서 'PR이 아직 없음' 안내가 나오고, 이어서 PR을 만드는지 본다.

## A7. 중복 이벤트 (Run F, A6 다음)

목적: 같은 승인을 여러 번 처리해도 기록과 PR이 한 번만 생기는지 본다.

1. A6에서 PR까지 만든 뒤 입력한다.
   > 승인된 인계를 다시 반영해 줘.
2. 에이전트가 이미 처리됐다고 알리고 새 커밋이나 PR을 만들지 않는지 본다.
3. 대시보드에서 같은 작업을 다시 열어 승인 버튼이 없는지(승인 내용만 보이는지) 본다.
4. `inspect.mjs`에서 `records_written=1`, `pr_created=1`, `approval_received=1`인지 본다. GitHub에서 PR이 하나인지 본다.

## A8. 일시적 오류 (Run G)

목적: 일시적 오류에 스크립트가 한 번만 재시도하고, 종료 코드 75 뒤 에이전트가 다시 실행하지 않는지 본다. 가짜 `gh`가 네트워크 오류를 낸다.

1. 로컬 모드 fixture를 만들고 원격 주소를 GitHub처럼 바꾼다. 실제 GitHub에는 닿지 않는다.
   ```sh
   git -C $F/work remote set-url origin git@github.com:acme/widgets.git
   echo '{"fail":"network"}' > $F/gh-state.json
   cd $F/work && PATH=$H/tests/helpers/fake-gh:$PATH FAKE_GH_STATE=$F/gh-state.json FAKE_GH_LOG=$F/gh-log.jsonl \
     GIT_SSH_COMMAND=false claude --plugin-dir $H
   ```
2. A1의 1~4번을 진행한다.
3. `apply.mjs`가 `E_TRANSIENT`, 종료 코드 75로 끝나는지 본다. 기록 파일은 이미 써졌다(상태 `applied`).
4. 에이전트가 `apply.mjs`를 다시 실행하지 않고 실패와 힌트를 보고하는지 본다.
5. `$F/gh-log.jsonl`에 `pr list` 호출이 정확히 두 번(최초 + 재시도 1회)인지 본다.
6. 복구: `echo '{}' > $F/gh-state.json` 뒤 "다시 시도해 줘"라고 입력한다. 기록을 다시 쓰지 않고 PR 단계로 넘어가는지 본다. 가짜 gh는 PR을 만들지 못하므로 `gh pr create`에서 멈추면 정상이다.

## A9. 병렬 worktree (Run A, A1 다음)

목적: 두 worktree의 작업과 승인이 섞이지 않고, 한쪽이 승인한 대체가 다른 쪽에 경고로만 보이는지 본다. `feat/rounding-change`의 spec은 A1의 '반올림하지 않는다' 결정을 대체한다.

1. A1에서 머지까지 마친 fixture에서 두 번째 worktree를 만든다.
   ```sh
   git -C $F/work worktree add $F/work-b feat/rounding-change
   git -C $F/work-b merge -q origin/main
   git -C $F/work checkout -q -b feat/other origin/main
   ```
2. 터미널 B(`cd $F/work-b`)에서 세션을 시작하고 입력한다.
   > docs/superpowers/specs/2026-11-13-rounding.md를 구현하고 최종 리뷰까지 마쳐 줘.

   decision 초안이 기존 decision을 `supersede`로 대체하는지 본다. 승인하고 "반영해줘"로 기록까지 쓰게 한다. 머지는 하지 않는다.
3. 대시보드 전체 목록에서 두 작업이 서로 다른 worktree 경로와 브랜치로 나뉘어 있는지 본다.
4. 터미널 A(`cd $F/work`, 브랜치 `feat/other`)에서 새 세션을 시작한다. 세션 시작 맥락의 '다른 작업의 머지 대기 변경'에 대체 제안이 보이는지 본다. 입력한다.
   > src/temperature.mjs와 관련된 결정을 조회해 줘.

   기존 decision은 `active`로 오고, `pendingWarnings`에 `supersede`가 있는지 본다. 에이전트가 대체 제안을 현재 규칙처럼 따르지 않아야 한다.
5. B의 브랜치를 머지한다(GitHub: PR 머지 뒤 fetch, 로컬: `merge-local.sh $F feat/rounding-change`).
6. A에서 새 세션으로 다시 조회한다. 기존 decision은 결과에 없고(비활성), 새 decision이 `active`이며, 경고가 사라졌는지 본다.

## A10. 편집 중 갱신 (Run F)

목적: 대시보드에서 편집하는 동안 초안이 다시 제출돼도 사람의 입력이 덮이지 않는지 본다.

1. `feat/kelvin`에서 A1의 1~2번을 진행해 승인 대기 상태로 만든다. 승인하지 않는다.
2. 대시보드 `PR 요약` 탭에서 불릿 하나를 고치고 저장하지 않은 채 둔다. `decision` 탭에서도 제목 하나를 고친다.
3. 다른 터미널에서 초안을 바꿔 다시 제출한다.
   ```sh
   T=<taskId>
   node -e "const f=process.argv[1];const fs=require('fs');const d=JSON.parse(fs.readFileSync(f));d.summary[0].text+=' (재제출)';fs.writeFileSync(f,JSON.stringify(d,null,2))" $HEIRLOOM_HOME/tasks/$T/draft.json
   node $H/skills/prepare-handoff/scripts/submit-draft.mjs --task $T
   ```
4. 화면의 입력이 그대로 남고 '새 초안이 있음' 배너만 뜨는지 본다. 탭을 오가도 입력이 유지되는지 본다.
5. 배너로 새 초안을 불러오면 재제출한 문구가 보이는지 본다. 고친 내용을 다시 입력하고 A6으로 넘어간다.

## 판정과 반영

- 시나리오마다 기록표의 확인 항목이 모두 '예'이면 통과다. 하나라도 '아니오'면 실패로 적고 근거(transcript 위치, `inspect.mjs` 출력, 화면)를 남긴다.
- 실패가 제품 결함이면 재현 테스트를 먼저 쓰고 고친다(AGENTS.md 4절). 에이전트 행동 문제면 해당 SKILL.md 문구를 고치고 같은 시나리오를 다시 돌린다.
- 10개가 모두 통과하면 MVP-PLAN M6의 마지막 체크박스를 표시한다.
