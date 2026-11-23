#!/usr/bin/env bash
# รันเว็บ (docker compose) + ชุด Playwright (container ทางการของ Playwright) ภายใน WSL
# ใช้: scripts/run-suite.sh <ชื่อรอบ> [BUG_MODE] [-- playwright args...]
#   scripts/run-suite.sh normal-1
#   scripts/run-suite.sh bug-B03 B03 -- e2e/part1/sla.spec.ts
# ผลลัพธ์: tests/runs/<ชื่อรอบ>/{results.json,list.txt,html/}
set -uo pipefail

RUN="${1:?ชื่อรอบ}"; shift || true
BUG="${1:-}"; [ $# -gt 0 ] && shift || true
[ "${1:-}" = "--" ] && shift
PW_ARGS=("$@")

HERE="$(cd "$(dirname "$0")/.." && pwd)"             # .../app
PORT="${HOST_PORT:-3000}"
WORK="${EGOV_TEST_WORK:-$HOME/egov-tests-work}"       # สำเนาชุดเทสต์บน filesystem ของ WSL (เร็วกว่า /mnt/c)
IMG="mcr.microsoft.com/playwright:v1.56.1-noble"
OUT="$HERE/tests/runs/$RUN"
mkdir -p "$OUT" "$WORK"

echo "== [$RUN] BUG_MODE='${BUG}' port=$PORT"
cd "$HERE"
docker compose down -v >/dev/null 2>&1 || true
rm -rf "$HERE/data" && mkdir -p "$HERE/data"
HOST_PORT="$PORT" TEST_MODE=1 BUG_MODE="$BUG" docker compose up -d --build >"$OUT/compose.log" 2>&1 || { echo "compose up ล้ม"; tail -20 "$OUT/compose.log"; exit 3; }

for i in $(seq 1 60); do
  curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "http://localhost:$PORT/api/health" >/dev/null || { echo "เว็บไม่ขึ้น"; docker compose logs --tail 40; exit 3; }

# สำเนาชุดเทสต์ (ไม่เอา node_modules/runs ของ Windows)
rsync -a --delete --exclude node_modules --exclude runs --exclude test-results "$HERE/tests/" "$WORK/"
if [ ! -d "$WORK/node_modules/@playwright" ]; then
  echo "== npm ci (ครั้งแรก)"
  docker run --rm -v "$WORK:/t" -w /t "$IMG" sh -c "npm ci --no-audit --no-fund && chown -R $(id -u):$(id -g) /t" >"$OUT/npm-ci.log" 2>&1 || { tail -20 "$OUT/npm-ci.log"; exit 3; }
fi

rm -rf "$WORK/runs" "$WORK/test-results"
docker run --rm --network host --ipc=host \
  -v "$WORK:/t" -v "$HERE/data:/data:ro" -w /t \
  -e BASE_URL="http://localhost:$PORT" -e DB_PATH=/data/egov.db \
  -e PW_JSON_OUT="runs/$RUN/results.json" -e PW_HTML_OUT="runs/$RUN/html" \
  -e PW_VIDEO="${PW_VIDEO:-off}" \
  -e RUN="$RUN" -e PLAYWRIGHT_HTML_OUTPUT_DIR="runs/$RUN/html" -e PLAYWRIGHT_HTML_OPEN=never -e OWNER="$(id -u):$(id -g)" \
  "$IMG" sh -c 'PLAYWRIGHT_JSON_OUTPUT_NAME="runs/$RUN/results.json" npx playwright test --reporter=list,json,html "$@"; c=$?; chown -R "$OWNER" /t; exit $c' sh "${PW_ARGS[@]}" >"$OUT/list.txt" 2>&1
CODE=$?

cp -r "$WORK/runs/$RUN/." "$OUT/" 2>/dev/null || true
docker compose logs --no-color >"$OUT/web.log" 2>&1 || true
docker compose down -v >/dev/null 2>&1 || true

echo "== exit=$CODE  → $OUT"
tail -25 "$OUT/list.txt"
exit $CODE
