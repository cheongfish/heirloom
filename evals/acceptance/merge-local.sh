#!/usr/bin/env bash
# 로컬 원격 모드와 가짜 원격 모드에서 "PR 머지"를 흉내 낸다: 작업 브랜치를 upstream에 올려 main에 머지하고,
# 작업 저장소에서 fetch한다. GitHub 모드에서는 쓰지 않는다(실제 PR을 머지한다).
# 사용법: merge-local.sh <fixture 디렉터리> <브랜치>
set -euo pipefail
fixture="$(cd "${1:?usage: merge-local.sh <fixture> <branch>}" && pwd)"
branch="${2:?usage: merge-local.sh <fixture> <branch>}"
g() { git -c user.name=acceptance -c user.email=acceptance@example.invalid "$@"; }

git -C "$fixture/work" push -q origin "$branch:$branch"
g -C "$fixture/upstream" merge -q --no-ff -m "Merge $branch" "$branch"
# 가짜 원격 모드에서도 동작하도록 upstream 경로에서 직접 가져온다.
git -C "$fixture/work" fetch -q "$fixture/upstream" '+refs/heads/*:refs/remotes/origin/*'
echo "upstream main에 $branch를 머지하고 work에서 fetch함: $(git -C "$fixture/work" rev-parse --short origin/main)"
