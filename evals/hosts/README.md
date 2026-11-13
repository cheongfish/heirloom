# 호스트 단계 1 실험 도구

Codex와 Antigravity CLI에서 단계 1 실험(인계 호출의 누락·오호출, 규약 주입, 종료 시 상기)을 헤드리스로 반복하는 도구다. 시나리오와 판정 기준은 [`../codex/README.md`](../codex/README.md)와 [`../antigravity/README.md`](../antigravity/README.md)에 있다. Claude Code는 [`../claude-code/`](../claude-code/README.md)를 따른다. CI에서는 실행하지 않는다.

## `run.mjs`

```sh
node evals/hosts/run.mjs --host codex|antigravity --scenario S1 --out <빈 디렉터리> [--timeout-min 15]
```

- `<out>/fx`에 `evals/claude-code/setup-fixture.sh`로 픽스처를 만들고, `<out>/home`을 `HEIRLOOM_HOME`으로 쓴다. 브라우저 열기는 끄고, 대시보드 포트는 실행마다 다르게 정한다. `HEIRLOOM_HOOK_LOG=1`로 훅 입력과 출력을 `<out>/home/hook-log.jsonl`에 남긴다.
- 시나리오 준비: S5는 test 스크립트를 `exit 1`로 바꾸고, S7은 `HEIRLOOM_DISABLE_CONVENTION=1`로 세션 시작 주입을 끈다. S8·S10은 같은 세션을 이어서 두 번째 프롬프트를 실행한다(Codex `exec resume`, Antigravity `--conversation`). Codex S9는 공식 마켓플레이스의 Superpowers를 그 실행에서만 켠다.
- 호스트 실행:
  - Codex: `codex exec --dangerously-bypass-hook-trust --json -s workspace-write --add-dir <home>`. 샌드박스 쓰기는 작업 공간과 `HEIRLOOM_HOME`뿐이고 네트워크는 막힌다(대시보드 서버가 뜨지 못해도 인계는 저장된다).
  - Antigravity: `agy -p --dangerously-skip-permissions --add-dir <home> --output-format json`. 헤드리스에서 허용되지 않은 명령은 출력 없이 실행을 끝내고 Stop 훅도 돌지 않아, 측정을 흐리지 않도록 권한을 자동 승인한다. 일회용 픽스처에서만 쓴다.
- 작업이 승인 대기가 된 뒤 60초가 지나면 실행을 끝낸다(인계 뒤 승인 대기에 시간을 쓰지 않는다). 시간 상한(기본 15분, S9 40분)을 넘겨도 끝낸다.
- `<out>/result.json`: 실제 모델, 세션 ID, 주입 횟수, 상기 횟수, Stop 입력의 종료 이유, 인계 작업 목록, 단계별 마지막 메시지·시간·사용량, 자동 판정. 자동 판정은 출발점이다. 마지막 메시지를 읽고 기록표에서 확정한다.

## 준비

릴리스 브랜치와 같은 파일만 모은 복사본으로 설치한다(작업 트리를 그대로 설치하면 개발 파일까지 복사된다).

```sh
H=<heirloom 저장소 경로>
C=<빈 디렉터리>/heirloom
mkdir -p $C && (cd $H && cp -r .claude-plugin .codex-plugin .antigravity-plugin hooks hooks.json rules skills examples $C/)
codex plugin marketplace add $C && codex plugin add heirloom@heirloom
agy plugin install $C
```

Antigravity S7은 상시 규칙도 규약을 주므로 `rules/`를 뺀 복사본으로 다시 설치하고 돌린다. 끝나면 `codex plugin remove heirloom@heirloom`, `codex plugin marketplace remove heirloom`, `agy plugin uninstall heirloom`으로 지운다.
