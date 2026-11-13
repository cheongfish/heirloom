# Antigravity 인계 호출 평가

PLAN 7.5절의 호스트 등급과 PLAN 18절의 누락률·오호출률을 Antigravity CLI(`agy`)에서 측정한다. 시나리오와 측정 대상은 [`../codex/README.md`](../codex/README.md)와 같다. 헤드리스 시나리오는 [`../hosts/run.mjs`](../hosts/README.md)로 돌리고, S4·S6은 사람이 대화형으로 진행한다. CI에서는 실행하지 않는다.

## Antigravity에서 다른 점

- 훅 파일은 플러그인 루트의 `hooks.json`이다. SessionStart는 `injectSteps`의 시스템 메시지로 주입하고, Stop 상기는 `decision: "continue"`다.
- 압축 훅이 없다. 압축 뒤 규약은 상시 규칙(`rules/heirloom.md`)과 압축 요약에 남는지로 본다. 기록에서 `CHECKPOINT` 단계가 압축 경계다.
- Stop은 취소·오류·한도 도달·`/compact`에도 실행된다. Heirloom은 `terminationReason`이 `NO_TOOL_CALL`일 때만 상기한다. 훅 로그의 `stops`에 종료 이유가 남는다.
- S7은 상시 규칙도 규약을 주므로 `rules/`를 뺀 복사본을 설치하고 돌린다.
- S9: Antigravity용 Superpowers는 공식 배포가 없어(커뮤니티 이식본만 있음) SDLC 없이 긴 작업 프롬프트로 돌린다.
- 기록은 `~/.gemini/antigravity-cli/brain/<대화 ID>/.system_generated/logs/transcript_full.jsonl`이다. 대화 ID는 `result.json`의 `session`이다.
- 세션을 이어서 하려면 `agy -p … --conversation <ID>`(헤드리스) 또는 `agy -c`(대화형)를 쓴다.

## 시나리오

[`../codex/README.md`](../codex/README.md)의 표와 같다. S6의 압축 명령은 `/compact`다. 판정에서 S6은 압축 뒤 SessionStart가 다시 실행되지 않으므로 '압축 뒤 규약 재주입' 대신 '압축 뒤 규약 유지(규칙·요약)'를 본다.

대화형 시나리오의 준비:

```sh
H=<heirloom 저장소 경로>; F=<빈 디렉터리>
$H/evals/claude-code/setup-fixture.sh $F/fx && mkdir -p $F/home
echo '{"schemaVersion":1,"dashboard":{"openBrowser":false}}' > $F/home/config.json
cd $F/fx/work && HEIRLOOM_HOME=$F/home HEIRLOOM_PORT=17392 HEIRLOOM_HOOK_LOG=1 agy
```

## 기록

[`../codex/README.md`](../codex/README.md)와 같은 방식으로 `results/<날짜>-step1.md`에 모은다.
