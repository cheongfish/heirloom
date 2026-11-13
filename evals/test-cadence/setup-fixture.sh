#!/usr/bin/env bash
# testCadence 점검용 소비 프로젝트를 만든다. Superpowers로 계획을 쓰고 구현할 만한 spec 하나와
# 기존 테스트가 있는 작은 저장소다. 두 번째 인자가 phase면 .heirloom/config.json에
# testCadence.mode를 켠다(기준선은 off).
#
#   upstream/  원격 역할(main)
#   work/      작업 저장소, 브랜치 feat/units
#
# 사용법: setup-fixture.sh <빈 디렉터리> off|phase
set -euo pipefail
target="${1:?usage: setup-fixture.sh <empty directory> off|phase}"
mode="${2:?usage: setup-fixture.sh <empty directory> off|phase}"
if [ -e "$target" ] && [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
  echo "비어 있지 않은 디렉터리: $target" >&2
  exit 2
fi
mkdir -p "$target"
cd "$target"
target="$(pwd)"
g() { git -c user.name=cadence -c user.email=cadence@example.invalid "$@"; }

git init -q -b main upstream
(
  cd upstream
  mkdir -p src test docs/superpowers/specs
  cat > package.json <<'JSON'
{ "name": "cadence-fixture", "private": true, "type": "module", "scripts": { "test": "node --test" } }
JSON
  cat > src/temperature.mjs <<'JS'
export function celsiusToFahrenheit(c) {
  return (c * 9) / 5 + 32;
}
JS
  cat > test/temperature.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { celsiusToFahrenheit } from '../src/temperature.mjs';

test('celsiusToFahrenheit', () => {
  assert.equal(celsiusToFahrenheit(100), 212);
});
JS
  cat > src/length.mjs <<'JS'
export function inchToCm(inch) {
  return inch * 2.54;
}
JS
  cat > test/length.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inchToCm } from '../src/length.mjs';

test('inchToCm', () => {
  assert.equal(inchToCm(1), 2.54);
});
JS
  cat > .gitmessage <<'TXT'
# <type>: <요약>
# type: feat, fix, docs, test, chore
TXT
  cat > docs/superpowers/specs/2026-11-13-units.md <<'MD'
# 온도 변환 확장과 표시

## 요구사항

### 변환 (src/temperature.mjs)
- `celsiusToKelvin(c)`와 `kelvinToCelsius(k)`를 추가한다. 절대영도(-273.15°C, 0K) 미만 입력은 `RangeError`를 던진다.
- `fahrenheitToCelsius(f)`를 추가한다.
- `convert(value, from, to)`를 추가한다. 단위는 `"C"`, `"F"`, `"K"`이고, 모르는 단위는 `TypeError`를 던진다. 위 함수들을 조합해 구현한다.

### 표시 (src/format.mjs, 새 파일)
- `formatTemperature(value, unit)`는 소수 첫째 자리까지 고정해 `"21.5°C"`, `"70.7°F"`, `"294.7K"`처럼 돌려준다.
- `parseTemperature(text)`는 `formatTemperature`의 출력 형식을 읽어 `{ value, unit }`을 돌려준다. 형식이 맞지 않으면 `SyntaxError`를 던진다.

### 테스트
- `node --test`로 실행되는 테스트를 `test/` 아래에 모듈별로 둔다.

## 결정
- 변환 결과는 반올림하지 않는다. 표시 형식은 화면마다 다르므로 호출하는 쪽이 정해야 하기 때문이다.
MD
  if [ "$mode" = "phase" ]; then
    mkdir -p .heirloom
    printf '{\n  "schemaVersion": 1,\n  "testCadence": { "mode": "phase" }\n}\n' > .heirloom/config.json
  fi
  g add -A
  g commit -q -m "initial"
)
git clone -q upstream work
cd work
git config user.name cadence
git config user.email cadence@example.invalid
git checkout -q -b feat/units
echo "작업 저장소: $target/work (브랜치 feat/units, testCadence=$mode)"
