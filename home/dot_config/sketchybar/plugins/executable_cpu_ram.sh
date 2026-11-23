#!/usr/bin/env bash

# CPU: single top sample (user + sys %)
top_out=$(top -l 1 -n 0 2>/dev/null | grep 'CPU usage:')
user_pct=$(echo "$top_out" | awk '{gsub(/%/,"",$3); printf "%d", $3+0.5}')
sys_pct=$(echo "$top_out" | awk '{gsub(/%/,"",$5); printf "%d", $5+0.5}')
CPU=$((user_pct + sys_pct))

# RAM: wired + active + compressed pages out of total
page_size=$(sysctl -n hw.pagesize 2>/dev/null)
total_bytes=$(sysctl -n hw.memsize 2>/dev/null)
vm_out=$(vm_stat 2>/dev/null)

wired=$(echo "$vm_out" | awk '/Pages wired down/             {gsub(/\./, "", $NF); print $NF+0}')
active=$(echo "$vm_out" | awk '/Pages active:/               {gsub(/\./, "", $NF); print $NF+0}')
compressed=$(echo "$vm_out" | awk '/Pages occupied by compressor/ {gsub(/\./, "", $NF); print $NF+0}')

used_bytes=$(((wired + active + compressed) * page_size))
RAM=$(((100 * used_bytes + total_bytes / 2) / total_bytes))
((RAM < 0)) && RAM=0
((RAM > 100)) && RAM=100

sketchybar --set cpu label="${CPU}%"
sketchybar --set ram label="${RAM}%"
