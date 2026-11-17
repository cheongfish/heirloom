#!/usr/bin/env bash
# 결정이 이력·변경 기록·문서·주석에서 보이는지 센다. 실행 조건 A/C와 같은 방식으로 clone한 뒤 검사한다.
# 사용법: burial-check.sh <case 디렉터리>   (case.json의 burial_keywords, burial_grep_paths를 쓴다)
set -eu
CASE="$(cd "${1:?usage: burial-check.sh <case dir>}" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
git clone -q --single-branch --branch main --no-tags "file://$CASE/src" "$T/w"
git -C "$T/w" remote remove origin
mapfile -t KW < <(python3 -I -c 'import json,sys;[print(k) for k in json.load(open(sys.argv[1]))["burial_keywords"]]' "$CASE/case.json")
mapfile -t GP < <(python3 -I -c 'import json,sys;[print(k) for k in json.load(open(sys.argv[1]))["burial_grep_paths"]]' "$CASE/case.json")
cd "$T/w"
echo "refs: $(git for-each-ref --format='%(refname)' | tr '\n' ' ')"
for k in "${KW[@]}"; do
  n=$(git log --all --oneline -i -F --grep="$k" | wc -l)
  printf -- '--- git log --all -i --grep=%q: %s\n' "$k" "$n"
  git log --all --oneline -i -F --grep="$k" | head -3 | sed 's/^/    /'
done
for k in "${KW[@]}"; do
  n=$(grep -r -i -F -h -- "$k" "${GP[@]}" 2>/dev/null | wc -l)
  printf -- '--- grep -ri %q in %s: %s lines\n' "$k" "${GP[*]}" "$n"
done
