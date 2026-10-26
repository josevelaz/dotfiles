#!/usr/bin/env bash
# Two-pass encode of a high-quality master into web delivery files plus a frame-0 poster.
# Usage: encode.sh master.mp4 out/demo   -> out/demo.mp4, out/demo.webm, out/demo-poster.jpg
# Override bitrates if a file lands over the size budget: MP4_KBPS=1300 WEBM_KBPS=1200 encode.sh ...
set -euo pipefail
in=${1:?master video}; out=${2:?output prefix}
mp4=${MP4_KBPS:-1550}; webm=${WEBM_KBPS:-1450}
mkdir -p "$(dirname "$out")"; tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# H.264 High, yuv420p, faststart, no audio
for pass in 1 2; do
  dst=/dev/null; [ $pass = 2 ] && dst="$out.mp4"
  ffmpeg -v error -y -i "$in" -an -c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p \
    -b:v ${mp4}k -maxrate $((mp4 * 2))k -bufsize $((mp4 * 4))k -pass $pass -passlogfile "$tmp/x264" \
    -movflags +faststart -f mp4 "$dst"
done

# VP9, yuv420p, no audio
for pass in 1 2; do
  dst=/dev/null; [ $pass = 2 ] && dst="$out.webm"
  ffmpeg -v error -y -i "$in" -an -c:v libvpx-vp9 -pix_fmt yuv420p -b:v ${webm}k -maxrate $((webm * 2))k \
    -row-mt 1 -cpu-used 1 -pass $pass -passlogfile "$tmp/vp9" -f webm "$dst"
done

# Poster = frame 0 of the master
ffmpeg -v error -y -i "$in" -frames:v 1 -q:v 2 "$out-poster.jpg"
ls -l "$out.mp4" "$out.webm" "$out-poster.jpg"
