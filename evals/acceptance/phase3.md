# 3차 수용 점검 (B1~B6)

3차 기능(증분 재확인, GitLab MR, 별도 맥락 정리)을 실제 Claude Code 세션으로 끝까지 돌려 본다. 방법은 [MVP 점검](README.md)과 같다. 점검하는 에이전트가 fixture에서 자식 `claude -p` 세션을 실행하고 transcript와 상태로 판정한다. 다른 점은 대시보드 조작이다. 사람 대신 헤드리스 Chromium이 실제 화면을 눌러 승인한다(`dashboard.mjs`). 화면을 사람이 직접 보는 확인은 하지 않는다. 대신 화면 글자와 캡처를 근거로 남긴다.

CI에서는 실행하지 않는다. 실제 GitHub·GitLab 원격으로 하는 확인은 원격 저장소가 생긴 뒤 MVP의 남은 기준과 함께 한다.

## 파일

| 파일 | 용도 |
| --- | --- |
| `setup-fixture.sh <dir> [--fake-github \| --fake-gitlab]` | fixture를 만든다. 3차는 `feat/units` 브랜치(서로 다른 파일에 걸린 decision 두 개)를 쓴다. 가짜 원격 모드는 원격 주소만 github.com·gitlab.com 형식이고 push는 로컬 upstream으로 간다. `--fake-gitlab`은 main에 MR 템플릿(`Default.md`, `Bug.md`)을 둔다. |
| `fetch-local.sh <dir>` | 가짜 원격 모드에서 `git fetch origin`을 대신한다. |
| `merge-local.sh <dir> <branch>` | 머지를 흉내 낸다. 가짜 원격 모드에서도 동작한다. |
| `upstream-change.sh <dir>` | B3용. 다른 사람이 main에 올린 변경을 흉내 내고 현재 브랜치를 rebase한다. |
| `seed-decisions.mjs <dir> [--more]` | B6용. 승인·머지된 decision 5개를 main에 만든다. `--more`는 무관한 decision 하나를 더한다. |
| `dashboard.mjs <url> --steps '<JSON>'` | 대시보드 화면 조작. 단계 종류는 파일 머리 주석에 있다. |
| `inspect.mjs` | 작업 상태와 이벤트를 본다(MVP와 같음). |
| `results-template-phase3.md` | 기록표. |

가짜 `gh`·`glab`(`tests/helpers/fake-gh`, `fake-glab`)은 만든 PR·MR과 본문을 상태 파일에 남긴다. 본문 대조는 그 파일로 한다.

## 공통 준비

```sh
H=<heirloom 저장소 경로>
F=~/heirloom-acceptance/run-X                 # 실행마다 새 디렉터리
$H/evals/acceptance/setup-fixture.sh $F [--fake-github | --fake-gitlab]
git -C $F/work checkout -q feat/units
mkdir -p $F/home && echo '{"schemaVersion":1,"dashboard":{"openBrowser":false}}' > $F/home/config.json
export HEIRLOOM_HOME=$F/home HEIRLOOM_PORT=1739x GIT_TERMINAL_PROMPT=0
# 가짜 원격 모드: GIT_SSH_COMMAND=false, PATH 앞에 fake-gh 또는 fake-glab, FAKE_GH_STATE/LOG 또는 FAKE_GLAB_STATE/LOG
export PLAYWRIGHT_CORE=<npx로 받은 playwright-core 디렉터리> CHROMIUM=<chromium 실행 파일>
COMMON=(--model sonnet --max-budget-usd 5 --plugin-dir $H --add-dir $F/home --add-dir /tmp --permission-mode acceptEdits
  --allowedTools "Bash(node *)" "Bash(git *)" "Bash(npm *)" "Bash(mktemp *)" <원격별 도구>
  --output-format stream-json --verbose)
cd $F/work && claude -p "<프롬프트>" "${COMMON[@]}" > $F/s1.jsonl
```

- 원격별 도구: GitHub 모드는 `"Bash(gh pr create *)" "Bash(gh pr edit *)"`를 더한다. GitLab 모드는 더하지 않는다. MR은 `node …/open-mr.mjs`로 만들기 때문이다. 이것으로 헤드리스 정리와 같은 허용 범위가 함께 확인된다.
- 세션은 인계 뒤 `wait-approval.mjs`를 백그라운드로 돌리며 기다린다. 그동안 대시보드 URL을 얻어 승인한다.

```sh
URL=$(node $H/skills/using-heirloom/scripts/open-dashboard.mjs --task <taskId> --no-browser | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.url')
node $H/evals/acceptance/dashboard.mjs "$URL" --text --shot $F/shots/x.png \
  --steps '[{"tab":"decision"},{"click":"decision 모두 승인"},{"click":"승인 저장"},{"wait":2000}]'
```

## 실행 묶음

| 실행 | 원격 | 시나리오 |
| --- | --- | --- |
| Run H | `--fake-github` | B1 승인 뒤 리뷰 수정 → B2 PR 작성 뒤 수정 (PR이 있는 상태에서 재확인) |
| Run I | 로컬 | B3 대상 브랜치 rebase → B4 검토 중 추가 변경 |
| Run J | `--fake-gitlab` | B5 GitLab MR (템플릿, 닫힘 만료) |
| Run K | 로컬 | B6 정리 실행부터 정리 결과 머지, 두 번째 정리까지 |
| Run L | `--fake-gitlab` | B6 변형: 헤드리스 반영 단계가 GitLab MR까지 만드는지 |

## B1·B2. 리뷰 수정과 PR 뒤 수정 (Run H)

1. `docs/superpowers/specs/2026-11-14-units.md를 구현하고 테스트와 최종 리뷰까지 마쳐 줘.`로 세션을 시작한다. 인계되면 요약 불릿 하나를 고치고 decision을 모두 승인한다. 세션이 반영하고 가짜 PR을 만든 뒤 `complete.mjs`까지 가는지 본다.
2. 리뷰 문서를 커밋한다. 이 문서는 `src/format.mjs`만 고치라고 요청한다.
   ```sh
   mkdir -p $F/work/docs/superpowers/reviews && cat > $F/work/docs/superpowers/reviews/2026-11-14-units-review.md <<'MD'
   # PR 리뷰: 켈빈 변환과 섭씨 표시

   ## 수정 요청
   - `formatCelsius(-0.04)`가 `"-0.0°C"`를 돌려준다. 0으로 반올림되는 음수는 `"0.0°C"`로 표시한다. `src/format.mjs`만 고치고 테스트를 더한다.
   MD
   git -C $F/work add -A && git -C $F/work commit -qm "docs: PR 리뷰"
   ```
3. 새 세션에서 `PR 리뷰가 docs/superpowers/reviews/2026-11-14-units-review.md에 왔어. 반영해 줘.`를 입력한다.
4. 대시보드 `개요`의 '증분 재확인'을 본다. 바뀐 파일, 기준 승인, 유지 항목 수가 있어야 한다. `PR 요약`과 `decision` 탭에서는 format 쪽 항목만 결정 대상이고, 켈빈 decision과 요약 1번은 '승인 유지'로 접혀 있어야 한다.
5. format decision의 제목을 고쳐 승인한다. 세션이 기록을 다시 쓰고, 같은 PR 본문을 갱신(`gh pr edit`)하고, 같은 URL로 `complete.mjs`를 실행하는지 본다. 가짜 gh 상태 파일의 PR 본문이 새 승인 요약과 같아야 한다. 기록 파일에는 `revisions`가 없어야 한다.

## B3·B4. rebase와 검토 중 변경 (Run I)

1. Run H의 1번과 같이 인계하고 승인한다(로컬 원격이라 PR 없이 `unsupported_remote`를 알린다).
2. `$H/evals/acceptance/upstream-change.sh $F`. 이 스크립트는 main에서 `src/temperature.mjs`(작업도 바꾼 파일)와 `src/other.mjs`(무관한 파일)를 바꾸고 `feat/units`를 rebase한다.
3. 새 세션: `main의 최신 변경을 받아서 feat/units를 rebase했어. 승인된 인계가 아직 유효한지 확인하고, 필요한 Heirloom 처리를 해 줘.`
4. B3 확인: `개요`에 '대상 브랜치가 갱신됨'이 있고, 바뀐 파일은 `src/temperature.mjs`의 '기준 브랜치 갱신으로 인한 변경' 하나여야 한다. `src/other.mjs`는 없어야 한다.
5. B4: 같은 화면에서 결정을 고른 뒤, 화면을 연 채로 파일을 바꾸고 승인한다.
   ```sh
   node $H/evals/acceptance/dashboard.mjs "$URL" --text --steps '[{"tab":"decision"},{"decide":"decision 항목 1","value":"승인"},
     {"exec":"cd '$F'/work && printf \"\\n// 표시 함수는 이 파일에 둔다.\\n\" >> src/format.mjs"},{"click":"승인 저장"},{"wait":2000}]'
   ```
   '승인할 수 없음 … 인계 이후 소스가 바뀌어 승인할 수 없음'이 보여야 한다. 기다리던 세션은 끝낸다.
6. 새 세션: `대시보드에서 승인하려니 '인계 이후 소스가 바뀌어 승인할 수 없음'이 나와. 검토하는 동안 src/format.mjs에 주석을 하나 더했어. 처리해 줘.` 다음 증분의 `recheck.basedOn`이 처음 승인과 같은지 본다. `src/format.mjs`는 '수정'으로 보여야 한다(대상 브랜치가 바꾸지 않은 파일). 승인하면 반영된다.

## B5. GitLab MR (Run J)

1. `--fake-gitlab` fixture에서 Run H의 1번과 같이 진행한다. 허용 도구에 `glab`은 넣지 않는다.
2. 에이전트가 `open-mr.mjs`로 MR을 만드는지 본다. 가짜 glab 상태 파일의 MR 본문이 `Default.md` 템플릿의 제목(`## 요약`, `## 테스트`)과 승인 요약을 그대로 담아야 한다. `complete.mjs`가 기록한 `pr_created` 이벤트에 `provider: gitlab`이 있어야 한다.
3. 상태 파일에서 MR을 `"state": "closed"`로 바꾸고 대시보드 전체 목록을 연다. 몇 초 뒤 작업 화면이 '만료됨'이고 `expired` 이벤트(`reason: pr_closed`)가 있어야 한다.

## B6. 맥락 정리 (Run K, Run L)

1. 로컬 fixture에 사용자 설정 `curation.agent`(`model: "sonnet"`)를 두고 `HEIRLOOM_HOME=$F/home node $H/evals/acceptance/seed-decisions.mjs $F`를 실행한다.
2. 사용자 작업 트리를 바꿔 둔다(`feat/kelvin`에서 커밋하지 않은 수정). `(git status --porcelain; git rev-parse HEAD; git branch --show-current; git diff) | sha256sum`을 남긴다.
3. 전체 목록에서 '정리 실행'을 누른다. 헤드리스 초안 단계가 끝나면 작업 화면을 본다. 중복 정리와 axiom 후보(근거 decision 2개 이상)가 있어야 한다.
4. axiom 후보를 이유 없이 거절하면 '승인 저장'이 잠기는지 본다. 이유를 적어 거절하고 나머지를 승인한다.
5. 헤드리스 반영 단계 뒤 전용 worktree의 커밋에 `.heirloom/curation/c-*.json`이 있고, 거절 이유가 그대로 담겼는지 본다. 사용자 작업 트리의 해시가 같아야 한다.
6. 정리 브랜치를 머지하고(`merge-local.sh $F heirloom/curate-…`), `seed-decisions.mjs $F --more`로 무관한 decision을 하나 더한다. 전체 목록에서 첫 정리가 끝났고 전용 worktree와 브랜치가 지워졌는지 본다.
7. 다시 '정리 실행'. 이전에 거절한 후보를 새 근거 없이 다시 제안하지 않아야 한다.
8. Run L은 `--fake-gitlab` fixture에서 1·3번을 하고 모두 승인한다. 반영 단계가 `open-mr.mjs`로 MR을 만들고 `complete.mjs`까지 가는지 본다.

## 판정

- 시나리오마다 기록표의 확인 항목이 모두 '예'이면 통과다.
- 제품 결함은 재현 테스트를 먼저 쓰고 고친다. 에이전트 행동 문제는 SKILL.md를 고치고 같은 시나리오를 다시 돌린다.
- B1~B6이 모두 통과하면 3차 계획의 N4 수용 점검 체크박스를 표시한다.
