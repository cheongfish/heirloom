#!/usr/bin/env bash
# 평가용 소비 프로젝트를 만든다: upstream(원격)과 그 clone(작업 저장소), spec 한 개.
# 사용법: evals/claude-code/setup-fixture.sh <빈 디렉터리>
set -euo pipefail

target="${1:?usage: setup-fixture.sh <empty directory>}"
mkdir -p "$target"
cd "$target"

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
{ "name": "eval-fixture", "private": true, "type": "module", "scripts": { "test": "node --test" } }
JSON
  git add -A
  git -c user.name=eval -c user.email=eval@example.invalid commit -q -m "initial"
)

git clone -q upstream work
cd work
git checkout -q -b feat/kelvin
mkdir -p docs/superpowers/specs
cat > docs/superpowers/specs/2026-11-12-kelvin.md <<'MD'
# 켈빈 변환 추가

## 요구사항
- `src/temperature.mjs`에 `celsiusToKelvin(c)`와 `kelvinToCelsius(k)`를 추가한다.
- 절대영도(-273.15°C) 미만 입력은 `RangeError`를 던진다.
- `node --test`로 실행되는 테스트를 `test/temperature.test.mjs`에 둔다.

## 결정
- 소수점 반올림은 하지 않는다. 표시 형식은 호출하는 쪽이 정한다.
MD
git add -A
git -c user.name=eval -c user.email=eval@example.invalid commit -q -m "docs: kelvin spec"
echo "작업 저장소: $PWD"
