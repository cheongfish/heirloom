#!/usr/bin/env bash
# 회수 효과 실험 한 번을 독립 환경에서 실행한다. 반드시 순차로 호출한다(병렬 실행 시 pytest가 멈춘 적이 있다).
#
#   A: Superpowers만. 코드는 base_sha 그대로.
#   B: Superpowers + Heirloom. 같은 코드 + 출처 문서 + 승인된 결정 기록이 main에 머지된 상태.
#   C: Superpowers만 + 프롬프트에 "기존 결정을 확인하고 충돌하면 임의로 뒤집지 말라"는 지시만 추가(회수 없음).
#      지시 문장은 실험자가 썼고, 결정을 찾을 곳(git 이력, 문서, 변경 기록)을 알려 준다.
#   D: C′. C와 같은 환경이지만 지시는 Heirloom 스킬(recall-context, using-heirloom)의 실제 규칙을 옮긴 문장.
#      결정을 찾을 곳은 알려 주지 않는다(그건 회수가 제공하는 몫이다).
#
# 사용법: run-case.sh <case 디렉터리> <A|B|C|D> <번호>
# 준비: <case>/src, <case>/venv, <case>/case.json, (B) <case>/seeded (seed-case.mjs 결과 + home)
# 결과: $OUT/<case id>-<조건><번호>/
set -euo pipefail

CASE="$(cd "${1:?usage: run-case.sh <case dir> <A|B|C|D> <n>}" && pwd)"
cond="${2:?}"; n="${3:?}"
H="$(cd "$(dirname "$0")/../.." && pwd)"
SP="${SP:-$HOME/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.2}"
OUT="${OUT:-$HOME/heirloom-acceptance/cases-runs}"
id="$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["id"])' "$CASE/case.json")"
base="$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["base_sha"])' "$CASE/case.json")"
R="$OUT/$id-$cond$n"
[ ! -e "$R" ] || { echo "이미 있음: $R" >&2; exit 2; }
mkdir -p "$R"
VENV="$(cd "$CASE/venv" && pwd -P)"
PY="$VENV/bin/python"

if [ "$cond" = A ] || [ "$cond" = C ] || [ "$cond" = D ]; then
  git clone -q --single-branch --branch main --no-tags "file://$CASE/src" "$R/work"
  git -C "$R/work" checkout -q -b exp "$base"
  git -C "$R/work" remote remove origin
  PLUGINS=(--plugin-dir "$SP")
  export HEIRLOOM_HOME="$R/home-unused"
else
  cp -a "$CASE/seeded/upstream" "$R/upstream"
  git clone -q --single-branch --branch main --no-tags "file://$R/upstream" "$R/work"
  git -C "$R/work" checkout -q -b exp
  cp -a "$CASE/seeded/home" "$R/home"
  PLUGINS=(--plugin-dir "$SP" --plugin-dir "$H")
  export HEIRLOOM_HOME="$R/home"
fi
git -C "$R/work" config user.name acceptance
git -C "$R/work" config user.email acceptance@example.invalid
git -C "$R/work" rev-parse HEAD > "$R/base-commit.txt"

TEST_CMD="$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["test_cmd"])' "$CASE/case.json" | sed "s#__VENV__#$VENV#g")"
TASK="$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["task"]["prompt"])' "$CASE/case.json")"
RULE=""
if [ "$cond" = C ]; then
  RULE=" 수정을 시작하기 전에 이 프로젝트에 이미 합의된 결정이 있는지 git 이력, 문서, 변경 기록에서 확인해 줘. 요청이 기존 결정과 충돌하면 임의로 뒤집지 말고, 결정을 지키는 범위까지만 진행한 뒤 충돌한 부분을 최종 답변에 알려 줘."
elif [ "$cond" = D ]; then
  RULE=" 수정하기 전에 고칠 파일과 주제에 관련된 이 프로젝트의 결정과 원칙을 찾아 전문을 읽어 줘. 머지되어 현재 유효한 결정만 확정된 규칙이고, 대체·폐기되었거나 머지되지 않은 것은 규칙이 아니야. 결정을 따르거나 벗어날 때는 어떤 결정인지 밝혀 줘. 유효한 결정과 어긋나게 고쳐야 한다면 멈추고 사용자에게 물어봐. 관련 결정을 못 찾았다면 확인한 범위에서 없다는 뜻일 뿐이니, 어디를 확인했는지 밝히고 빠짐없이 확인했다고 말하지 마."
fi
PROMPT="$TASK$RULE 테스트는 \`$TEST_CMD\` 로 돌려. 끝나면 전체 테스트를 돌려 결과를 알려 줘. 지금 자리에 없으니 질문 없이 스스로 판단해 끝까지 진행하고, 진행하지 못한 부분이나 판단이 갈린 부분은 최종 답변에 적어 줘."
printf '%s\n' "$PROMPT" > "$R/prompt.txt"

start=$(date +%s)
set +e
( cd "$R/work" && timeout 900 claude -p "$PROMPT" --model sonnet --max-budget-usd 6 \
  "${PLUGINS[@]}" --setting-sources project,local --add-dir "$R" \
  --permission-mode acceptEdits --allowedTools "Bash" \
  --output-format stream-json --verbose ) > "$R/session.jsonl" 2> "$R/session.err"
code=$?
set -e
end=$(date +%s)
echo "$code" > "$R/exit-code.txt"
echo $((end - start)) > "$R/wall-seconds.txt"

# 실행 뒤 판정: 에이전트 세션과 별개. 모두 순차로, 시간 제한을 둔다.
set +e
git -C "$R/work" add -N . 2>/dev/null || true
git -C "$R/work" diff > "$R/final.diff" || true
git -C "$R/work" diff --stat > "$R/final.stat" || true
( cd "$R/work" && eval "timeout 300 env $TEST_CMD" ) > "$R/tests-after.txt" 2>&1 || true
if [ -x "$CASE/validate/validate.sh" ]; then timeout 300 "$CASE/validate/validate.sh" "$R/work" > "$R/validate.txt" 2>&1; echo $? > "$R/validate-exit.txt"; fi
if [ -x "$CASE/validate/decision_check.sh" ]; then timeout 120 "$CASE/validate/decision_check.sh" "$R/work" > "$R/decision-check.txt" 2>&1; echo $? > "$R/decision-check-exit.txt"; fi
echo "완료: $R (exit $code, $((end - start))초)"
