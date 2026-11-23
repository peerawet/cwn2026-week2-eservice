#!/usr/bin/env bash
# แปลงวิดีโอของแต่ละ TC เป็น GIF → <ปลายทาง>/<TC>.gif
# ต้องรัน scripts/run-suite.sh ด้วย PW_VIDEO=on ก่อน   ใช้: bash scripts/make-gifs.sh <โฟลเดอร์ปลายทาง>
set -uo pipefail
OUT="${1:?โฟลเดอร์ปลายทาง}"
WORK="${EGOV_TEST_WORK:-$HOME/egov-tests-work}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BYTC="$WORK/test-results/by-tc"   # เทสต์เขียนวิดีโอลงโฟลเดอร์ตามรหัส TC โดยตรง (PW_VIDEO=on)
[ -d "$BYTC" ] || { echo "ไม่พบ $BYTC — รัน run-suite.sh ด้วย PW_VIDEO=on ก่อน"; exit 3; }
docker build -q -t egov-gif:local "$HERE/gif" >/dev/null
rm -rf "$OUT"; mkdir -p "$OUT"
docker run --rm -v "$BYTC:/in:ro" -v "$OUT:/out" -e OWNER="$(id -u):$(id -g)" egov-gif:local bash -c '
set -u
for d in /in/*/; do
  tc=$(basename "$d")
  vids=$(ls -1tr "$d"*.webm)
  args=(); fc=""; n=0
  for v in $vids; do args+=(-i "$v"); fc="${fc}[$n:v]fps=5,scale=640:-2:flags=lanczos,setsar=1[v$n];"; n=$((n+1)); done
  cat=""; for i in $(seq 0 $((n-1))); do cat="${cat}[v$i]"; done
  # ต่อวิดีโอทุก context ของ TC · จำกัด 40 วินาที · พาเลตต์ 96 สีต่อไฟล์
  ffmpeg -loglevel error -y "${args[@]}" -filter_complex "${fc}${cat}concat=n=${n}:v=1:a=0,trim=duration=40,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" "/out/$tc.gif" \
    && echo "OK $tc $(stat -c %s /out/$tc.gif)" || echo "FAIL $tc"
done
chown -R "$OWNER" /out
'
