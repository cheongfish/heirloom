#!/usr/bin/env bash
# 수동 수용 점검용 소비 프로젝트를 만든다 (MVP-PLAN M6, PLAN 18절).
#
#   upstream/   원격 역할의 저장소 (main)
#   work/       작업 저장소 (upstream의 clone)
#
# 시나리오마다 브랜치가 있다.
#   feat/kelvin           정상 완료, 압축, 중단, 이벤트 유실, 중복, 일시적 오류, 편집 중 갱신
#   feat/format           자료 누락 (spec이 없는 설계 문서를 참조함)
#   feat/precision        문서 충돌 (spec과 plan이 반올림에 대해 다름)
#   feat/rounding-change  병렬 worktree (feat/kelvin의 반올림 결정을 대체하는 spec)
#
# 사용법:
#   setup-fixture.sh <빈 디렉터리>                  로컬 원격. PR 단계는 not_github로 건너뜀
#   setup-fixture.sh <빈 디렉터리> <GitHub 저장소 URL>  비어 있는 개인 GitHub 저장소로 PR까지 점검
set -euo pipefail

target="${1:?usage: setup-fixture.sh <empty directory> [github-remote-url]}"
github="${2:-}"
if [ -e "$target" ] && [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
  echo "비어 있지 않은 디렉터리: $target" >&2
  exit 2
fi
mkdir -p "$target"
cd "$target"
target="$(pwd)"

g() { git -c user.name=acceptance -c user.email=acceptance@example.invalid "$@"; }

git init -q -b main upstream
(
  cd upstream
  mkdir -p src
  cat > src/temperature.mjs <<'JS'
export function celsiusToFahrenheit(c) {
  return (c * 9) / 5 + 32;
}
JS
  cat > package.json <<'JSON'
{ "name": "acceptance-fixture", "private": true, "type": "module", "scripts": { "test": "node --test" } }
JSON
  cat > .gitmessage <<'TXT'
# <type>: <요약>
# type: feat, fix, docs, test, chore
TXT
  g add -A
  g commit -q -m "initial"
)

git clone -q upstream work
cd work
git config user.name acceptance
git config user.email acceptance@example.invalid

spec_branch() { # <branch> <file> <commit message>; content on stdin
  git checkout -q -b "$1" main
  mkdir -p "$(dirname "$2")"
  cat > "$2"
  git add -A
  g commit -q -m "$3"
}

spec_branch feat/kelvin docs/superpowers/specs/2026-11-12-kelvin.md "docs: kelvin spec" <<'MD'
# 켈빈 변환 추가

## 요구사항
- `src/temperature.mjs`에 `celsiusToKelvin(c)`와 `kelvinToCelsius(k)`를 추가한다.
- 절대영도(-273.15°C) 미만 입력은 `RangeError`를 던진다.
- `node --test`로 실행되는 테스트를 `test/temperature.test.mjs`에 둔다.

## 결정
- 소수점 반올림은 하지 않는다. 표시 형식은 화면마다 다르므로 호출하는 쪽이 정해야 하기 때문이다.
MD

spec_branch feat/format docs/superpowers/specs/2026-11-12-format.md "docs: format spec" <<'MD'
# 온도 표시 함수 추가

## 요구사항
- `src/format.mjs`에 `formatCelsius(c)`를 추가한다.
- 출력 형식(단위 기호, 자릿수, 음수 표기)은 `docs/design/temperature-format.md`의 표를 따른다.
- `node --test`로 실행되는 테스트를 `test/format.test.mjs`에 둔다.
MD

spec_branch feat/precision docs/superpowers/specs/2026-11-12-precision.md "docs: precision spec" <<'MD'
# 화씨 변환 정밀도

## 요구사항
- `celsiusToFahrenheit(c)`의 결과를 소수 둘째 자리에서 반올림해 돌려준다.
- `node --test`로 실행되는 테스트를 `test/precision.test.mjs`에 둔다.
MD
mkdir -p docs/superpowers/plans
cat > docs/superpowers/plans/2026-11-12-precision.md <<'MD'
# 화씨 변환 정밀도 구현 계획

1. 테스트를 먼저 쓴다.
2. `celsiusToFahrenheit`는 반올림하지 않고 계산 결과를 그대로 돌려준다. 반올림은 화면 쪽에서 한다.
3. 기존 호출부를 확인한다.
MD
git add -A
g commit -q -m "docs: precision plan"

spec_branch feat/rounding-change docs/superpowers/specs/2026-11-13-rounding.md "docs: rounding change spec" <<'MD'
# 켈빈 변환 반올림 변경

## 배경
- 켈빈 변환은 반올림하지 않기로 했지만, 화면마다 반올림이 달라 결과가 어긋난다.

## 요구사항
- `celsiusToKelvin(c)`와 `kelvinToCelsius(k)`의 결과를 소수 둘째 자리에서 반올림해 돌려준다.
- 테스트를 그에 맞게 고친다.

## 결정
- 켈빈 변환 결과는 소수 둘째 자리에서 반올림한다. 화면마다 반올림이 달라 결과가 어긋나기 때문이다. "반올림하지 않는다"는 기존 결정을 대체한다.
MD

git checkout -q feat/kelvin

if [ -n "$github" ]; then
  git remote set-url origin "$github"
  git push -q origin main:main
  git fetch -q origin
  git remote set-head origin main
  echo "원격: $github (main을 올림)"
else
  echo "원격: $target/upstream (로컬). PR 단계는 not_github로 건너뛴다."
fi

echo "작업 저장소: $target/work (브랜치 feat/kelvin)"
