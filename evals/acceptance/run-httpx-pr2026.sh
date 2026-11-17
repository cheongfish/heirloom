#!/usr/bin/env bash
# 회수 효과 실험(HTTPX PR #2026) 한 번을 독립 환경에서 실행한다.
#
#   A: Superpowers만. 코드는 7f0d43d(PR #2026 머지 시점) 그대로.
#   B: Superpowers + Heirloom. 같은 코드 + 출처 문서 + 승인된 결정 기록이 main에 머지된 상태.
#
# 사용법: run-httpx-pr2026.sh <A|B> <번호>
# 준비: ROOT/base-src(7f0d43d), ROOT/master(seed-httpx-pr2026.mjs 결과), ROOT/venv(pytest 등)
set -euo pipefail

cond="${1:?usage: run-httpx-pr2026.sh <A|B> <n>}"
n="${2:?usage: run-httpx-pr2026.sh <A|B> <n>}"
H="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="${ROOT:-$HOME/heirloom-acceptance/httpx-2026}"
SP="${SP:-$HOME/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.2}"
R="$ROOT/runs/$cond$n"
[ ! -e "$R" ] || { echo "이미 있음: $R" >&2; exit 2; }
mkdir -p "$R"

if [ "$cond" = A ]; then
  git clone -q "$ROOT/base-src" "$R/work"
  git -C "$R/work" checkout -q -b exp 7f0d43d
  PLUGINS=(--plugin-dir "$SP")
  export HEIRLOOM_HOME="$R/home-unused"
else
  cp -a "$ROOT/master/upstream" "$R/upstream"
  git clone -q "$R/upstream" "$R/work"
  git -C "$R/work" checkout -q -b exp
  cp -a "$ROOT/master/home" "$R/home"
  PLUGINS=(--plugin-dir "$SP" --plugin-dir "$H")
  export HEIRLOOM_HOME="$R/home"
fi
git -C "$R/work" config user.name acceptance
git -C "$R/work" config user.email acceptance@example.invalid
git -C "$R/work" rev-parse HEAD > "$R/base-commit.txt"

PY="$ROOT/venv/bin/python"
PROMPT="Client와 AsyncClient를 닫지 않은 채 버리면 연결 같은 리소스가 새는데, 사용자가 그 실수를 알아채기 어려워. 사용자가 실수를 알아챌 수 있게 안전장치를 넣어 줘. 테스트도 추가해 줘. 테스트는 $PY -m pytest 로 돌려. 끝나면 전체 테스트를 돌려 결과를 알려 줘. 지금 자리에 없으니 질문 없이 스스로 판단해 끝까지 진행하고, 진행하지 못한 부분이나 판단이 갈린 부분은 최종 답변에 적어 줘."
printf '%s\n' "$PROMPT" > "$R/prompt.txt"

start=$(date +%s)
set +e
( cd "$R/work" && timeout 1500 claude -p "$PROMPT" --model sonnet --max-budget-usd 6 \
  "${PLUGINS[@]}" --setting-sources project,local --add-dir "$R" \
  --permission-mode acceptEdits --allowedTools "Bash" \
  --output-format stream-json --verbose ) > "$R/session.jsonl" 2> "$R/session.err"
code=$?
set -e
end=$(date +%s)
echo "$code" > "$R/exit-code.txt"
echo $((end - start)) > "$R/wall-seconds.txt"

# 실행 뒤 판정용: 전체 테스트와 변경 요약. 에이전트 세션과는 별개다.
git -C "$R/work" add -N . 2>/dev/null || true
git -C "$R/work" diff > "$R/final.diff" || true
git -C "$R/work" diff --stat > "$R/final.stat" || true
( cd "$R/work" && "$PY" -m pytest -q -p no:cacheprovider tests ) > "$R/pytest-after.txt" 2>&1 || true
tail -3 "$R/pytest-after.txt"
echo "완료: $R (exit $code, $((end - start))초)"
