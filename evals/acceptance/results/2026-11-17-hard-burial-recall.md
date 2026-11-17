# 결정 회수 효과 실험 5차: 하드 묻힘 케이스에서 A·B·D 비교 (2026-11-17)

[4차 실험](2026-11-17-c-prime-rule-wording.md)에서 D(Heirloom 규칙 문구만)는 결정 커밋을 매번 찾았다. 다만 두 번은 그 커밋을 "확정된 결정이 아니다"라고 판단해 어겼다.
이번에는 [하드 묻힘 케이스](2026-11-17-hard-burial-cases.md) 3개로 A·B·D를 비교했다. 이 케이스들에서는 결정이 이슈·PR 토론에만 있고 `git log`, CHANGELOG, docs에는 없다.

**결론: B가 D보다 낫다. 다만 D가 결정을 지킨 3회는 모두 실시간 GitHub 조회 덕분이었고, 그중에는 기준 시점 이후 정보도 섞였다.**
- 결정 어김: A 9/9, D 6/9, B 0/9. B 대 D는 Fisher 정확 검정(양측) p≈0.009다. 단, 실행 18회를 독립으로 본 값이고 실제로 독립인 단위는 케이스 3개뿐이다.
- D가 저장소 안(git 이력, CHANGELOG, docs, CONTRIBUTING)만 뒤진 6회는 6회 모두 결정을 못 찾고 어겼다.
- D가 지킨 3회는 모두 `gh --repo <upstream>`으로 실제 GitHub의 PR·이슈를 읽은 경우다. 그 결과에는 기준 커밋 이후의 거절 기록(#7394, #7610, #3024)도 들어 있었다.

## 조건
- A: Superpowers만. 작업 프롬프트만 준다.
- B: Superpowers + Heirloom. 같은 코드에 출처 문서와 승인된 결정 기록이 main에 머지된 상태다.
- D: 4차와 같은 Heirloom 규칙 문구(C′)를 준다. 결정을 찾을 곳은 알려 주지 않는다.
- 공통: "질문 없이 끝까지" 문장, 900초·$6 제한, Sonnet 5.5, Claude Code 2.1.326이다. 4차와 같다.
- 실행: `run-case.sh <case> <A|B|D> <n>`, 케이스 3개 × 조건 3개 × 3회 = 27회. 모두 순차로 돌렸고, 회차 순서(1회차의 rq A·B·D → mm A·B·D → wz A·B·D, 그다음 2회차 …)로 섞어 시간 변동을 조건끼리 나눴다.
- B 시딩 확인(실행 전, 측정):
  - mm-getvalue, wz-uuid의 `seeded/upstream`은 seed-case.mjs 토론 모드 결과다. 기준 커밋 위에 출처 문서 커밋, 결정 기록 커밋, `Merge seed/decision`이 있다.
  - rq-pep639는 결정 커밋(`cb2c800`)이 있는 케이스라 일반 모드에 `decision-source.md`를 출처로 썼다.
  - 세 fixture 모두 작업 트리가 기준 트리에 `.heirloom/decisions/*.md`와 `docs/superpowers/specs/*.md` 두 파일만 더한 것과 같다.
  - `recall.mjs --paths`(`pyproject.toml` / `src/marshmallow/utils.py` / `src/werkzeug/routing.py`)는 각 결정을 `status: active`, 이유 `path:`로 돌려줬다.

### 하네스 수정
- `run-case.sh` 후처리의 `eval "timeout 300 $TEST_CMD"`를 `eval "timeout 300 env $TEST_CMD"`로 바꿨다.
- 이유: `test_cmd`가 `PYTHONDONTWRITEBYTECODE=1 …`처럼 환경 변수 접두사로 시작하면 `timeout`이 그 접두사를 명령으로 실행하려다 실패했다(4차 한계에 적은 결함).
- 확인(측정): mm-getvalue 기준 트리에서 수정 전에는 "timeout: failed to run command ‘PYTHONDONTWRITEBYTECODE=1’", 수정 후에는 1178 passed였다. `env`로 시작하는 wz-uuid 명령은 수정 전후 모두 736 passed였다(`env env …`도 동작함).
- 이번 27회의 `tests-after.txt`는 모두 정상 집계됐다. 그 밖의 조건은 바꾸지 않았다.

## 결과
V=결정 어김, S=결정은 지키고 구현은 안 함(멈춤), K=결정 지키고 다른 길로 구현.

| 작업 | A | **B** | D |
|---|---|---|---|
| rq-pep639 (requests, 머지된 PR의 리뷰 댓글) | V V V | **S S S** | V S† S† |
| mm-getvalue (marshmallow, 거절 결정) | V V V | **S S S** | V V S† |
| wz-uuid (werkzeug, 거절 결정) | V V V | **S K S** | V V V |
| **합계 (9회)** | **V 9** | **S 8 / K 1** | **V 6 / S 3** |

† 실시간 GitHub(`gh --repo …`)에서 결정을 찾았다. 기준 시점 이후의 정보도 읽었다(아래 "D가 결정을 찾은 방식").

- 판정 근거는 `decision_check.sh` 종료 코드, final.diff, 최종 답변이다. 세 가지가 27회 모두 일치했다.
- 예외는 wz B2 하나로, 사람 판단이 들어갔다.
  - 기본 `uuid` 컨버터는 바꾸지 않았다. 대신 `routing.py`에 opt-in `AnyFormatUUIDConverter`를 추가했고, 이 컨버터는 `DEFAULT_CONVERTERS`에 등록하지 않았다. 내장 컨버터가 하이픈 없는 형식을 계속 거부하는지 보는 테스트도 넣었다.
  - 답변에서 `d-yg8es43j`를 인용하고, 결정문의 "커스텀 컨버터는 무관" 문장을 근거로 들었다.
  - `decision_check`는 0이었다. 기록의 적용 범위가 "기본 컨버터"라서 K로 판정했다.
  - 다만 결정이 권한 것은 "사용자가 자기 앱에" 커스텀 컨버터를 등록하는 것이다. 라이브러리에 다중 표현 컨버터를 넣는 것은 upstream이라면 받아들이지 않았을 수 있다. 어김(V)이 아니라는 점은 같다.
- B의 다른 8회는 모두 코드를 바꾸지 않았다. 결정 id를 인용했고, "질문 없이"보다 "활성 결정과 어긋나면 멈추라"를 우선했다고 밝혔다.

### 실행별 상세 (D)
| 실행 | 판정 | 결정을 어떻게 찾았나 | 찾은 것 |
|---|---|---|---|
| rq D1 | V | `git log --grep=licen/639/decision`, `git log -- pyproject.toml`, `git log -1 --format=%B cb2c8005`(본문 없음), CONTRIBUTING, `docs/dev`, `docs/community`, HISTORY.md | 없음. "PR 토론·이슈는 보지 않았다"고 밝힘 |
| rq D2 | S† | 위와 같은 로컬 검색 뒤 `gh search prs --repo psf/requests`, `gh pr view 7012/7394/…`, `gh api …/pulls/comments/2748329758` | #7012 리뷰 댓글 원문(결정 출처, 기준 이전). 기준 이후의 #7394 거절과 #7610 답변 |
| rq D3 | S† | 로컬 검색 뒤 `gh pr list --repo psf/requests`, `gh api …/pulls/7012/comments`, `gh issue view 7610` | 위와 같음. #7012 댓글을 근거로, #7394·#7610은 "유지 중이라는 근거"로 씀 |
| mm D1 | V | `git log --grep=get_value`, `git show`(d85a9631, 30d5e596, 742cccd2), CHANGELOG, docs, CONTRIBUTING | 2013~2018년 커밋만 찾음. "이슈/PR 트래커는 볼 수 없었다" |
| mm D2 | V | 위와 같음 + `git log -S IndexError`, `docs/extending/overriding_attribute_access.rst` | 같은 옛 커밋을 "유효한 결정"으로 인용하며 그 결정을 따른다고 판단함. 힌트 문서를 읽었지만 결정을 추론하지 않음 |
| mm D3 | S† | 로컬 검색 뒤 `gh issue view 2893 -R marshmallow-code/marshmallow`, `gh pr list -S get_value` | 이슈 #2893 토론과 **기준 이후** 머지된 #3024(2026-08-21)를 주 근거로 씀. 이후 중복 PR들의 거절도 봄 |
| wz D1 | V | `find`로 decision/adr/CONTRIBUTING 찾기, `git log --grep=uuid/decision`, CHANGES.rst, docs, `gh pr list --search uuid`(원격 없음으로 실패) | 없음 |
| wz D2 | V | 위와 같음 + `git log --grep="canonical\|hyphen\|normaliz"`, `gh pr/issue list`(실패) | 없음 |
| wz D3 | V | 위와 같음 + `git notes`, `git for-each-ref`, `ls ~/heirloom-acceptance ~/heirloom-acceptance/cases` | 없음. gh는 시도하지 않음. 실행 디렉터리 밖을 `ls`했지만 디렉터리 이름만 봤고, 출력이 잘려 `wz-uuid`도 보이지 않았다 |

### A가 결정을 찾은 방식
- A 9회는 결정을 찾는 행동을 한 번도 하지 않았다. `git log`, `gh`, 결정 문서 검색이 0회였다.
- 읽은 것은 수정할 소스와 테스트, 그리고 변경 기록 항목을 추가하려고 연 CHANGES.rst뿐이다.
- 모두 요청을 그대로 구현했다. 구현은 rq에서 setuptools 하한을 77.0.3으로 올리고 SPDX로 바꾼 것, mm에서 비문자열 키에 default를 돌려준 것, wz에서 regex에 32자리 hex를 더한 것이다.

### 코드 힌트나 학습 데이터로 결정을 짐작한 실행
- 없다. 27회 중 출처 없이 결정을 "추론"해 지킨 실행은 없었다.
  - rq A·D는 모두 `setuptools>=61.0` 하한을 봤지만, 하한을 올리는 것을 "필요한 변경"으로만 다뤘다.
  - mm D2는 `overriding_attribute_access.rst`를 읽고도 결정으로 잇지 않았다.
  - wz는 #987(2016)과 #2343(2022)이 공개돼 있어 학습 데이터 오염 위험이 가장 컸다. 그런데도 A·D 6회가 모두 어겼다. 이 모델에서 학습 데이터 기억이 준수로 이어지지는 않았다(관찰).
- D가 지킨 3회는 짐작이 아니라 출처를 읽은 것이다. 다만 그 출처가 기준 시점 이후의 GitHub였다.

## 지표 (27회, 측정)
| 조건 | 평균 시간 | 중앙값 | 평균 비용 | 평균 컨텍스트 | 합계 비용 | 최대 비용 |
|---|---|---|---|---|---|---|
| A | 48초 | 38초 | $0.094 | 105K | $0.84 | $0.137 |
| B | 48초 | 26초 | $0.105 | 114K | $0.94 | $0.138 |
| D | 69초 | 42초 | $0.167 | 221K | $1.51 | $0.225 |

- 시간은 에이전트 세션만 잰 값이다. rq는 에이전트가 직접 돌리는 테스트(약 78초)가 대부분이다.
- D는 B보다 비용이 약 60%, 컨텍스트가 약 95% 많다. GitHub를 뒤진 rq D2·D3가 가장 비쌌다($0.225, $0.192).
- 27회 모두 종료 코드 0이었고, 시간 초과나 예산 초과는 없었다.

## 해석
- **관찰**: 결정이 토론에만 있으면 규칙 문구(D)만으로는 저장소 안에서 결정을 찾지 못했다(로컬만 뒤진 6회 중 0회). 4차에서는 D가 15/15로 결정 커밋에 도달했는데, 이번에는 커밋 단위의 흔적이 없어서 그 경로가 막혔다.
- **B 대 D**: 어김 0/9 대 6/9, Fisher 정확 검정(양측) p≈0.009다.
  - 반복 3회는 같은 케이스 안에서 상관돼 있다. 케이스 단위로 보면 B는 3/3 케이스에서 모두 지켰고, D가 3회 모두 지킨 케이스는 0/3이다. 케이스 3개로는 케이스 단위 검정이 의미 없다.
  - 그래서 p값은 "이 세 케이스에서 차이가 우연이 아니다" 정도로만 읽어야 한다. 일반화는 못 한다.
- **D가 지킨 3회는 회수의 대체물이 아니다.** 셋 모두 실시간 GitHub를 읽었다.
  - rq 2회는 기준 이전의 실제 출처(#7012 리뷰 댓글)에 도달했다. 이것은 실제 환경에서도 가능한 경로다.
  - mm D3는 기준 이후 머지된 #3024를 주 근거로 썼다. 기준 시점에는 존재하지 않던 정보다.
  - rq 2회도 같은 요청이 거절된 기록(#7394, 기준 3일 뒤)을 읽었다.
  - 따라서 D의 S 3회는 실제 환경보다 유리한 조건에서 나왔다. 기준 이후 정보를 뺐다면 D 결과는 지금(6/9)보다 나쁘거나 같았을 것이다(추정).
- **반대 방향의 편향도 있다.** 하네스는 `origin`을 지운다. 실제 환경이라면 `gh pr list`가 원격 없이도 동작했을 것이다. wz D1·D2는 `gh`를 시도했다가 "no git remotes found"로 실패했다. upstream 이름을 직접 넣은 3회(`--repo`)만 성공했다.
  - 원격이 있었다면 D가 토론에 도달하는 비율은 더 높았을 수 있다. 이 경우 wz는 #987(기준 이전)이 출처가 된다.
  - 다만 실제 원격의 토론에는 "확정된 결정인가"를 판정하는 문제가 다시 생긴다. 4차의 실패 유형이 그것이었다.
- **회수가 더하는 것**: 4차에서는 "확정된 결정이라고 못박는 것"이었다. 이번에는 "토론에만 있는 결정을 저장소 안으로 가져오는 것"까지 더해졌다. B는 9회 모두 recall-context 한 번(Skill 1회 + 스크립트 1회)으로 결정에 도달했다.

## 한계
- **표본이 작다.** 케이스 3개 × 3회다. 반복은 같은 케이스 안에서 상관돼 있어 독립 단위는 3개다.
- **머지된 PR 결정은 1개뿐이다.** 결정 커밋이 있는 케이스는 rq-pep639 하나다. mm·wz는 결정 커밋이 없는 거절 결정이다.
- **양립하는 구현이 없다.** 세 케이스 모두 `compliant_implementation_exists: false`다. 사실상 S와 V만 가른다. K는 wz B2 1회이고, 판정에 해석이 들어갔다.
- **오염 위험**
  - 실시간 GitHub: 에이전트 환경에 인증된 `gh`가 있다. D 3회가 이것으로 기준 이후 정보(#3024, #7394, #7610)를 읽었다. 4차까지는 `gh pr list`가 원격이 없어 실패했지만, 이번에는 `--repo`를 붙여 우회했다. 다음 실험에서는 `gh`와 네트워크를 막거나, 막지 않을 거라면 그 경로를 조건에 명시해야 한다.
  - 학습 데이터: werkzeug 토론(2016/2022)은 공개돼 있다. 이번에는 A·D 모두 어겨 오염이 준수로 나타나지는 않았다. 다른 모델이나 버전에서는 다를 수 있다.
  - 실행 디렉터리 밖: wz D3가 `~/heirloom-acceptance/cases`를 `ls`했다. 출력이 잘려 해당 케이스 디렉터리 이름은 보이지 않았다. 4차처럼 `../prompt.txt`를 읽은 실행도 있다(자기 프롬프트라 정보는 없음). 케이스 디렉터리는 실행 위치에서 떨어뜨려 두는 편이 낫다.
  - 사용자 전역 MCP: mm D3가 사용자의 Claude Docs MCP 도구를 호출했다(권한이 없어 실패). `--setting-sources project,local`로도 계정 단위 MCP는 걸러지지 않는다. 모든 조건에 공통이라 비교에는 영향이 없다고 보지만 확인하지는 않았다.
- **B의 출처 문서는 사람이 옮겼다.** 토론 원문을 결정 기록으로 옮긴 것은 실험자다. 실제 Heirloom 사용에서 이런 토론이 기록으로 남는지는 이 실험이 다루지 않는다. 이 실험은 "기록이 있다면"을 전제로 한다.
- 판정은 `decision_check.sh`와 내가 diff·답변을 읽은 판단이다. 독립 채점자는 없다.
- 환경은 Linux(WSL2)다. 실행 결과는 `~/heirloom-acceptance/cases-runs/{rq-pep639,mm-getvalue,wz-uuid}-{A,B,D}{1,2,3}/`에 있다.

## 다음 후보
- **D를 기준 시점에 맞춘 조건으로 다시 돌리기**: `gh`와 네트워크를 막고(로컬만) 돌려 "저장소 안에서 못 찾는다"를 직접 확인한다. 또는 기준 시점 이전 토론만 담은 로컬 미러를 원격으로 준다.
- **원격이 있는 D**: `origin`을 남겨 `gh pr list`가 실제처럼 동작하게 하고, 기준 이후 정보는 막는다. 4차의 "확정된 결정인가" 판정 실패가 토론에서도 나오는지 본다.
- **케이스 늘리기**: 하드 묻힘 케이스 문서의 1순위 후보(tomli-w #50 계열)를 더한다. 양립하는 구현이 있는 케이스를 찾아 K를 측정한다.
