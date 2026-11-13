#!/usr/bin/env bash
# 가짜 원격 모드(--fake-github, --fake-gitlab)에서 `git fetch origin`을 대신한다. 원격 주소는
# github.com·gitlab.com 형식이라 fetch가 실패하므로, 로컬 upstream에서 origin/* 추적 브랜치를 갱신한다.
# 사용법: fetch-local.sh <fixture 디렉터리>
set -euo pipefail
fixture="$(cd "${1:?usage: fetch-local.sh <fixture>}" && pwd)"
git -C "$fixture/work" fetch -q "$fixture/upstream" '+refs/heads/*:refs/remotes/origin/*'
echo "upstream에서 origin/*를 갱신함: origin/main $(git -C "$fixture/work" rev-parse --short origin/main)"
