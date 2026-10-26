#!/usr/bin/env bash
# Mechanical checks for a demo loop. View every image it writes before calling the video done.
# Usage: verify.sh demo.mp4 demo.webm demo-poster.jpg [outdir]
# Env: WIDTHS="620 340" (real display widths), MAX_MB=8, FORBIDDEN='regex' (OCR scan, needs tesseract)
set -euo pipefail
mp4=${1:?mp4}; webm=${2:?webm}; poster=${3:?poster}; out=${4:-verify}
WIDTHS=${WIDTHS:-"620 340"}; MAX_MB=${MAX_MB:-8}
mkdir -p "$out"

echo "== ffprobe"
for f in "$mp4" "$webm"; do
  ffprobe -v error -show_entries stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate \
    -show_entries format=duration,size,bit_rate -of compact "$f"
  [ -n "$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$f")" ] && echo "FAIL audio stream in $f"
  size=$(stat -c %s "$f"); [ "$size" -gt $((MAX_MB * 1000000)) ] && echo "FAIL $f is $size bytes"
done
python3 - "$mp4" <<'PY'
import struct, sys
d = open(sys.argv[1], 'rb').read(); i = 0; order = []
while i + 8 <= len(d):
    n, t = struct.unpack('>I4s', d[i:i+8]); order.append(t.decode('latin1'))
    if n == 1: n = struct.unpack('>Q', d[i+8:i+16])[0]
    if n < 8: break
    i += n
print('faststart OK' if order.index('moov') < order.index('mdat') else 'FAIL moov after mdat', order)
PY

fps=$(ffprobe -v error -select_streams v -show_entries stream=r_frame_rate -of csv=p=0 "$mp4" | awk -F/ '{printf "%d", $1 / ($2 ? $2 : 1)}')
nf=$(ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 "$mp4")
echo "frames=$nf fps=$fps"

echo "== poster vs frame 0, last frame vs frame 0 (SSIM)"
ffmpeg -v error -y -i "$mp4" -frames:v 1 "$out/first.png"
ffmpeg -v error -y -i "$mp4" -vf "select=eq(n\,$((nf - 1)))" -frames:v 1 "$out/last.png"
ffmpeg -v info -i "$poster" -i "$out/first.png" -lavfi ssim -f null - 2>&1 | grep -o 'All:[0-9.]*' | sed 's/^/poster /'
ffmpeg -v info -i "$out/last.png" -i "$out/first.png" -lavfi ssim -f null - 2>&1 | grep -o 'All:[0-9.]*' | sed 's/^/loop /'
ffmpeg -v error -y -i "$out/last.png" -i "$out/first.png" -filter_complex "[0][1]hstack,scale=1280:-1" "$out/loop_last_vs_first.jpg"

echo "== contact sheet, one frame per second"
cols=6; rows=$(( (nf / $fps + cols) / cols ))
ffmpeg -v error -y -i "$mp4" -vf "fps=1,scale=480:-1,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=22:fontcolor=yellow:box=1:boxcolor=black,tile=${cols}x${rows}" \
  -frames:v 1 "$out/sheet_persec.jpg"

echo "== likely cuts (scene score > 0.25): inspect each at frame level; 0.8 s zooms can look like cuts at 1 fps"
ffmpeg -v info -i "$mp4" -vf "select='gt(scene,0.25)',showinfo" -f null - 2>&1 | grep -o 'n:[ ]*[0-9]*.*pts_time:[0-9.]*' | awk '{print $1, $2, $NF}' | tee "$out/cuts.txt"
while read -r _ n _; do
  n=${n#n:}; [ -z "$n" ] && continue
  ffmpeg -v error -y -i "$mp4" -vf "select='between(n\,$((n - 3))\,$((n + 3)))',scale=480:-1,tile=7x1" -frames:v 1 "$out/cut_$n.jpg"
done < "$out/cuts.txt"

echo "== legibility downscales (one frame every 3 s; add zoom-hold times with HOLDS='10.5 25.0')"
times="$(seq 0 3 $(( nf / $fps - 1 ))) ${HOLDS:-}"
for w in $WIDTHS; do
  i=0; for s in $times; do ffmpeg -v error -y -ss "$s" -i "$mp4" -frames:v 1 -vf "scale=$w:-1:flags=area" "$out/legib_${w}_$(printf %02d $i).png"; i=$((i + 1)); done
  ffmpeg -v error -y -pattern_type glob -i "$out/legib_${w}_*.png" -vf "tile=3x$(( (i + 2) / 3 )):padding=8:color=white" -frames:v 1 "$out/legib_$w.png"
  rm -f "$out"/legib_${w}_*.png
done

if [ -n "${FORBIDDEN:-}" ] && command -v tesseract >/dev/null; then
  echo "== OCR scan for forbidden strings (complements the capture-time DOM audit)"
  tmp=$(mktemp -d); ffmpeg -v error -i "$mp4" -vf fps=2 "$tmp/%04d.png"
  for f in "$tmp"/*.png; do tesseract "$f" - 2>/dev/null | grep -iE "$FORBIDDEN" | sed "s|^|$(basename "$f"): |"; done || true
  rm -rf "$tmp"
fi
echo "done: view $out/*.jpg $out/*.png"
