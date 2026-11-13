#!/usr/bin/env bash
# B3(대상 브랜치 rebase) 점검용: 다른 사람이 upstream main에 올린 변경을 흉내 낸다.
#   - src/temperature.mjs 맨 위에 주석을 더한다(작업 브랜치도 바꾼 파일 → rebase 뒤 base_updated).
#   - src/other.mjs를 추가한다(작업과 무관 → 재확인 대상에 나오면 안 됨).
# 그런 다음 work에서 upstream을 가져와 현재 브랜치를 origin/main 위로 rebase한다.
# 사용법: upstream-change.sh <fixture 디렉터리>
set -euo pipefail
fixture="$(cd "${1:?usage: upstream-change.sh <fixture>}" && pwd)"
g() { git -c user.name=colleague -c user.email=colleague@example.invalid "$@"; }

up="$fixture/upstream"
{ printf '// 온도 변환 함수 모음.\n'; cat "$up/src/temperature.mjs"; } > "$up/src/temperature.mjs.new"
mv "$up/src/temperature.mjs.new" "$up/src/temperature.mjs"
printf 'export const other = 1;\n' > "$up/src/other.mjs"
g -C "$up" add -A
g -C "$up" commit -q -m "chore: 다른 사람의 main 변경"

git -C "$fixture/work" fetch -q "$up" '+refs/heads/*:refs/remotes/origin/*'
g -C "$fixture/work" rebase -q origin/main
echo "upstream main $(git -C "$up" rev-parse --short HEAD)에 변경을 올리고 $(git -C "$fixture/work" branch --show-current)를 rebase함"
