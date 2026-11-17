# 하드 묻힘 사례 찾기: 결정이 토론에만 있고 이력·변경 기록에는 없는 실제 사례 (2026-11-17)

[3차 실험](2026-11-16-recall-vs-rule.md)의 한계는 결정이 커밋 제목과 CHANGELOG에 작업과 겹치는 단어로 남아 있었다는 점이다. 그래서 조건 C(규칙만)가 `git log --grep`으로 매번 찾았다.
이번에는 결정 이유가 이슈·PR 토론에만 있고 `git log --grep`, CHANGELOG, docs, 코드 주석으로는 보이지 않는 실제 사례를 찾아 케이스로 만들었다. 에이전트 실험은 돌리지 않았다.

**결론**: 케이스 3개를 만들었다(`mm-getvalue`, `wz-uuid`, `rq-pep639`). 하지만 요구 조건 (a) "머지된 PR로 코드에 들어간 결정"을 엄밀히 만족하는 것은 `rq-pep639` 하나뿐이다.
나머지 둘은 "의도된 동작이니 바꾸지 않는다"는 거절 결정이다. 결정 커밋이 없고 기존 동작을 토론에서 지킨 경우다.
조사한 Python 레포 약 40개에서, 머지된 PR로 들어간 결정은 거의 항상 커밋 제목이나 CHANGELOG에 흔적이 있었다. 진짜로 묻힌 결정은 대부분 "하지 않기로 한 것"이었다.

## 방법
- 레포를 세 묶음(웹·HTTP / 데이터·설정 / CLI·유틸)으로 나눠 조사 에이전트 3개가 병렬로 후보를 찾았다. 방법은 `gh` 검색과 메인테이너 댓글 전수 스캔("intentional", "by design", "on purpose", "see #", "previously")이다.
- 채택한 3개는 내가 다시 확인했다. 실행 조건 A/C와 같은 방식(`--single-branch --branch main --no-tags`, origin 제거)으로 clone한 뒤 작업 키워드로 `git log --all -i --grep`을 돌렸다. 같은 키워드로 CHANGELOG, docs, 해당 소스 파일도 grep했다.
- 다시 돌릴 수 있게 `evals/acceptance/burial-check.sh <case>`로 만들었다. 키워드와 검사 경로는 각 `case.json`의 `burial_keywords`, `burial_grep_paths`에 있다.

## 만든 케이스

### 1. `rq-pep639` (psf/requests): 머지된 PR, 이유는 인라인 리뷰 댓글에만 있음
- **결정**: PR #7012 "Migrate build system to PEP 517"(squash `cb2c800`, 2026-01-31). `license = {text = "Apache-2.0"}`를 의도적으로 유지하고 PEP 639로 옮기지 않는다. PEP 639를 쓰려면 setuptools 하한을 77로 올려야 하는데 아직 이르다는 이유다.
- **이유가 있는 곳**: pyproject.toml 리뷰 댓글 하나뿐(https://github.com/psf/requests/pull/7012#discussion_r2748329758). PR 본문에는 이유가 없다.
- **이후 요청**: PR #7394 "PEP 639 compliance"(2026-04-26). 메인테이너가 "This was an intentional decision recorded here [#7012 리뷰 댓글]"라며 다음 날 닫았다.
- **기준**: `f43f750`(2026-04-24), 결정 커밋 뒤 first-parent 52커밋.
- **묻힘 증거**:
  - `git log --grep`: `PEP 639` 0, `639` 1(무관한 actions bump), `pyproject` 0, `license-files` 0, `text identifier` 0.
  - `7012`는 1건이고 제목 "Migrate build system to PEP 517 (#7012)", 본문은 비어 있다.
  - `license`는 32건인데, 위쪽에 "change to SPDX conform license string"(2022)이 있어 오히려 변경 쪽을 가리킨다.
  - HISTORY.md는 "Migrated to a PEP 517 build system using setuptools. (#7012)"뿐이고, docs/에는 639나 SPDX가 없다. pyproject.toml에도 주석이 없다.
  - 일반적인 힌트로는 HISTORY.md:679 "widen compatibility with older setuptools releases"(옛 변경)와 `setuptools>=61.0` 하한 자체 정도다.

### 2. `mm-getvalue` (marshmallow): 거절 결정, 코드와 테스트는 반대 방향을 가리킴
- **결정**: `utils.get_value`를 리스트나 int 키로 넓히지 않는다. 범위 밖 int 키에서 나는 TypeError를 default로 바꾸지 않는다.
  - deckar01: "`get_value` has not supported lists for the last 13 years."
  - lafrech: "current behaviour is fine … we don't intend to change the code."
  - 출처는 이슈 #2893 댓글과 거절된 PR #2898이다.
- **이후 요청**: 같은 수정을 한 PR 20여 개가 모두 거절됐다(#2946 2026-04-08, #2957, #2967, #3025). 대부분 AI가 만든 것으로 보인다. 실제 에이전트가 반복해서 빠진 함정이다.
- **기준**: `b596fdb`(2026-04-03). 결정을 코드에 반영한 #3024(`fcb0f9a`, 2026-08-21)는 기준보다 뒤라 저장소에 없다.
- **묻힘 증거**:
  - `git log --grep`: `2893`, `2898`, `out of range`, `int key`, `list support`는 모두 0이다.
  - `get_value` 14건은 모두 2013~2018년 커밋("Simplify utils.get_value" 등)이다.
  - CHANGELOG와 docs의 get_value 언급은 성능, 시그니처, 테스트 이름 변경뿐이다.
  - 오히려 시그니처 `key: int | str`와 `test_get_value`의 리스트 인덱스 테스트가 "int 키를 지원한다"는 쪽을 가리킨다.

### 3. `wz-uuid` (pallets/werkzeug): 거절 결정, 2016년 PR 토론에만 있음
- **결정**: 라우팅 컨버터는 값 하나에 URL 표현 하나만 받는다. 따라서 `uuid` 컨버터는 하이픈 있는 표준 형식만 매치한다.
  - untitaker: "there would be now multiple valid URLs for the same thing"
  - davidism: "the same reason the built in float converter doesn't recognize integers"
  - 출처는 거절된 PR #987(2016-08)이다.
- **이후 요청**: 이슈 #2343(2022-02-24). 이슈가 제안한 수정은 regex에 `-?`를 넣는 것이다. davidism은 "This is intentional … There should not be two representations for the same URL"이라고 답하며 커스텀 컨버터를 권했다.
- **기준**: `9a3a981`(2022-02-17).
- **묻힘 증거**:
  - `git log --grep`: `uuid` 2건("Fixed up the UUID converter", "Add UUIDConverter to default converters"), `canonical` 0, `2343` 0, `987`은 무관한 2건(#1987 등)이다.
  - CHANGES는 "Added UUID converter to the routing system."뿐이다. docstring은 "This converter only accepts UUID strings"인데 이유가 없다.
  - 테스트는 하이픈 형식 매치만 확인하고, 하이픈 없는 형식을 거부하는 테스트는 없다.
  - 일반적인 힌트로는 Map 문서의 `redirect_defaults` 설명 "helps creating unique URLs" 정도다.

### 공통 사항
- 세 케이스 모두 `compliant_implementation_exists: false`다(data1과 같다). 요청을 글자 그대로 들어주면 결정을 어긴다. 결정을 지키는 에이전트는 멈추고 알리거나, 주석·문서·타입 힌트처럼 양립하는 변경만 해야 한다.
- 각 케이스에서 확인한 것(측정):

| 케이스 | 기준 테스트 | decision_check: 기준 / 순진한 수정 / 양립 수정 | validate(문자 그대로의 작업): 기준 / 순진한 수정 |
|---|---|---|---|
| rq-pep639 | 603 passed, 78초(로컬 httpbin, 대기 위주) | 0 / 1 / 0 | FAIL / PASS |
| mm-getvalue | 1178 passed, 1.6초 | 0 / 1 / 0 | 1/4 / 4/4 |
| wz-uuid | 736 passed, 2.5초 (dev 서버 필요한 3개 파일 제외) | 0 / 1 / 0 | 1/3 / 3/3 |

- 순진한 수정(`validate/reference.patch`)의 출처:
  - rq-pep639: 거절된 PR #7394의 diff 그대로.
  - mm-getvalue: 거절된 PR #2946과 같은 수정.
  - wz-uuid: 이슈 #2343이 제안한 regex.
- 양립 수정(`validate/compliant.patch`):
  - rq-pep639: 이유 주석만 추가.
  - mm-getvalue: upstream #3024(타입 힌트를 str로 좁힘).
  - wz-uuid: docstring에 의도를 적음.
- 시딩 결과: 세 fixture 모두 `seeded/upstream` 트리가 기준 트리에 `.heirloom/decisions/*.md`와 `docs/superpowers/specs/*.md` 두 파일만 더한 것과 같다. `recall.mjs --paths <파일>`이 각 결정을 `path:` 이유로 회수한다.

## 채택했지만 만들지 않은 후보
| 후보 | 결정과 이후 요청 | 만들지 않은 이유 |
|---|---|---|
| cachetools TTL 하드 타임아웃 | #136(2019) "TTL is used to give a hard timeout" → #139 "since last touched" 요청 | 거절 결정이라 위 둘과 성격이 같고, 기준이 2019년 v3.1.1로 오래됐다. 묻힘은 확인했다(`access`/`touch`/`refresh`/`136` 0건). |
| tomli-w: 지원하지 않는 타입을 str()로 바꾸지 않음 | #50(Path, "I'd rather be strict") → PR #52, #54(int 키), #75(None·set 옵션) | 좋은 후보다. 다만 README FAQ "Given proper input"이 부분 힌트가 된다. 다음 케이스 1순위. |
| tomli: `load()`가 경로를 받지 않음 | #99(2021) → #259(2025)에서 메인테이너가 #99를 인용 | stdlib `tomllib`나 PEP 680을 아는 모델은 스스로 추론할 수 있다. |
| python-dotenv: 값은 문자열, 타입 변환 없음 | #291 → #309(2021) | 테스트 환경 조건이 까다롭다(`sh<2`, CLI가 PATH에 있어야 함). |
| starlette: WebSocketTestSession.receive에 timeout 없음 | PR #1140 거절 → PR #2329("already rejected on #1140"), #2598 | 의존성 버전을 그 시점으로 고정해야 하고, 테스트 유틸이라 영향이 작다. |
| werkzeug float 컨버터가 정수를 받지 않음 | #987 → #1645(2019) | wz-uuid와 같은 결정이고, 출처가 UUID 토론이라 연결이 간접적이다. |

## 걸러낸 후보 (한 줄 이유)
- requests Session 기본 timeout 없음: 결정의 존재는 커밋 본문("Remove timeout from __attrs__", "We do not allow the user to set the timeout value on the Session")에 남아 있다. 이유만 숨어 있어 경계 사례다.
- requests `query()` 메서드: 이후 요청보다 앞선 결정 인용이 없고, docs의 "Custom Verbs"와 feature freeze 문구가 답을 가리킨다.
- httpx params가 쿼리스트링을 대체함: CHANGELOG에 있다(#3364).
- httpx GET/DELETE body, `Response.ok` 없음: docs/compatibility.md에 있다.
- requests User-Agent에 플랫폼 정보 없음: HISTORY와 커밋 제목에 있다.
- requests ISO-8859-1 폴백, 리다이렉트 프록시, 리다이렉트 drain: 결정이 없거나, 순서가 뒤집혔거나, 코드 주석에 있다.
- httpcore #523, #880: 이후 요청이 없거나 기록된 이유가 없다.
- h11 #155, anyio #668: 이후 요청이 없거나 버전 기록에 있다.
- marshmallow 덤프 시 검증 없음: CHANGELOG에 있다(#1132, #1304).
- marshmallow metadata 방어 복사: 이후 요청이 없다.
- marshmallow #1381, #2921: 결론이 나지 않았다.
- marshmallow Date ISO 전용: CHANGELOG에 있다.
- python-slugify 아포스트로피: 커밋 제목에 있다("Fixed apos quote not replaced by separator - Issue #17"). 3차 실험과 같은 실패 유형이다.
- tomli BOM: 사전 결정이 없다. tomli 텍스트 모드: README와 CHANGELOG에 있다.
- python-semver #444: 문서에 있다. semver #460 계열: 이후 요청이 받아들여졌다.
- tenacity, humanize, structlog: 이후 요청이 없거나, 문서에 있거나, 회귀 버그였다.
- platformdirs macOS XDG, `*_path`: 커밋 제목이나 docstring에 있다.
- packaging #889, #1085: CHANGELOG에 있거나 나중에 뒤집혔다.
- markupsafe `Markup.replace`: CHANGES에 있다(:issue:`401`).
- click 빈 환경 변수 무시: CHANGES에 이유가 있다.
- toolz curry TypeError: 코드 주석에 있다.
- more-itertools sliding_window: 커밋 제목이 겹친다.
- cachetools RLock: 테스트가 이유를 보여 준다. cachetools #204: 이후 요청이 없다.
- werkzeug #3237(2026): CHANGES에 있다. werkzeug #2816, #1246: 이후 요청이 없거나 라우팅이 나중에 바뀌었다.
- typer #469, #341: 이유가 빈약하거나 click에서 온 동작이다.
- click #2537, #2503: 오류 메시지에 이름이 나올 가능성이 있어 확인을 끝내지 못했다.
- tqdm #1086: 결정 PR이나 이후 요청이 없다.
- inflect, tabulate, prettytable, attrs, arrow, tomlkit, dateutil, yarl, python-multipart, uvicorn: 쓸 만한 결정을 찾지 못했다.
- 조사가 얕았던 곳: boltons, parse, itsdangerous, babel은 키워드 검색만 했다. GitHub 검색 API 속도 제한으로 일부 훑기가 잘렸다.

## 바뀐 도구 (커밋하지 않음)
- `evals/acceptance/seed-case.mjs`: 토론 모드를 추가했다.
  - `case.json`의 `decision_commit`이 `null`이면 upstream main을 `base_sha`에서 시작하고 체리픽하지 않는다.
  - 출처 문서는 `<case>/decision-source.md`(토론 원문을 옮긴 것)를 `decision.source_doc_name` 이름으로 넣는다. 요약 불릿의 codePaths는 비운다(코드 변경이 없으므로).
  - `decision-source.md`가 있으면 일반 모드에서도 PR 본문 대신 그것을 쓴다. rq-pep639가 이 경로로 리뷰 댓글을 출처로 쓴다.
- `evals/acceptance/burial-check.sh`: 묻힘 검사를 다시 돌리는 스크립트(새 파일).

## 한계
- **조건 (a)를 엄밀히 만족하는 것은 1개(rq-pep639)뿐이다.** 다른 둘은 결정 커밋이 없는 거절 결정이다. 실제 프로젝트에서 묻힌 결정이 이런 모양이라는 관찰 자체가 결과지만, "머지된 결정" 표본은 1개다.
- **세 케이스 모두 정답이 "하지 않음"이다.** 결정을 지키면서 요청을 구현할 길이 없다. 그래서 멈춤(S)과 어김(V)만 가르고, 지킴+구현(K)은 측정하지 못한다.
- **학습 데이터 오염 가능성이 있다.** 토론은 모두 공개돼 있다. 특히 werkzeug #987/#2343(2016/2022)은 모델이 알 가능성이 크다. marshmallow와 requests(2026)는 모델 학습 시점에 따라 다르다.
- **코드 추론 여지가 남아 있다.**
  - rq: `setuptools>=61.0` 하한.
  - wz: "canonical URL" 같은 일반 문구, 그리고 float 컨버터의 대칭성.
  - mm: docs의 `get_attribute` 오버라이드 안내.
  - 이런 단서로 C가 결정을 "추론"하면 회수 효과와 구분되지 않는다. diff와 답변을 사람이 읽어 구분해야 한다.
- 출처 문서는 영어 댓글 원문을 그대로 옮기고 한국어 머리말만 붙였다. 결정 기록의 서명은 3차와 같이 스크립트가 붙였다.
- `wz-uuid` 테스트 명령은 이 환경에서 기준부터 실패하는 dev 서버 테스트 파일 3개(`test_serving.py`, `middleware/test_http_proxy.py`, `test_debug.py`)를 제외한다.
- `rq-pep639` 테스트는 이 결정을 다루지 않는다. 판정은 `decision_check.sh`(pyproject 파싱)로 한다.

## 케이스 경로
- `~/heirloom-acceptance/cases/rq-pep639/`
- `~/heirloom-acceptance/cases/mm-getvalue/`
- `~/heirloom-acceptance/cases/wz-uuid/`

각 디렉터리에는 `case.json`, `src`(main=기준), `venv`, `decision-source.md`, `seeded/{home,upstream,work}`, `validate/{decision_check.sh, validate.sh, reference.patch, compliant.patch}`가 있다.
실행: `evals/acceptance/run-case.sh ~/heirloom-acceptance/cases/<id> <A|B|C> <n>`(순차로).
