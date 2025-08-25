#!/usr/bin/env bash
set -euo pipefail

# memtest.sh — sample RSS for a process by PID or PM2 app name
# Usage:
#   memtest.sh --pid <PID> [--duration 10] [--interval 0.2]
#   memtest.sh --pm2 <APP_NAME> [--duration 10] [--interval 0.2]
#
# Outputs min/avg/max RSS in MB and writes time series to stdout.

duration=10
interval=0.2
pid=""
pm2_name=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pid)
      pid="$2"; shift 2;;
    --pm2)
      pm2_name="$2"; shift 2;;
    --duration)
      duration="$2"; shift 2;;
    --interval)
      interval="$2"; shift 2;;
    -h|--help)
      echo "Usage: $0 [--pid PID | --pm2 NAME] [--duration SEC] [--interval SEC]"; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

if [[ -z "$pid" && -z "$pm2_name" ]]; then
  echo "Error: provide --pid or --pm2" >&2; exit 1
fi

# Resolve PID from PM2 if needed
if [[ -n "$pm2_name" ]]; then
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "Error: pm2 not found in PATH" >&2; exit 1
  fi
  # Get PID from pm2 jlist (JSON). Fallback to pm2 pid <name>
  pid=$(pm2 jlist | awk -v name="$pm2_name" 'BEGIN{pid=""} /"name":/ {gsub(/[",]/,""); n=$2} /"pid":/ {gsub(/[",]/,""); p=$2; if (n==name && p>0) {print p; exit}}') || true
  if [[ -z "$pid" ]]; then
    pid=$(pm2 pid "$pm2_name" 2>/dev/null || true)
  fi
  if [[ -z "$pid" || "$pid" == "0" ]]; then
    echo "Error: could not resolve PID for PM2 app '$pm2_name'" >&2; exit 1
  fi
fi

if ! kill -0 "$pid" 2>/dev/null; then
  echo "Error: process $pid not running" >&2; exit 1
fi

platform=$(uname -s)

read_rss_kb() {
  # Print RSS in kilobytes (KB)
  case "$platform" in
    Darwin)
      # ps rss is KB on macOS
      ps -o rss= -p "$1" 2>/dev/null | awk '{print $1+0}'
      ;;
    Linux)
      # ps rss is KB on Linux
      ps -o rss= -p "$1" 2>/dev/null | awk '{print $1+0}'
      ;;
    *)
      # Best-effort using ps aux (RSS in KB)
      ps aux 2>/dev/null | awk -v p="$1" '$2==p{print $6+0}'
      ;;
  esac
}

samples=()
end_time=$(awk -v s="$(date +%s.%N)" -v d="$duration" 'BEGIN{printf "%.3f", s+d}')

echo "Sampling RSS for PID $pid every $interval s for $duration s ..." >&2
while :; do
  now=$(date +%s.%N)
  cmp=$(awk -v n="$now" -v e="$end_time" 'BEGIN{print (n<e)?0:1}')
  if [[ "$cmp" -ne 0 ]]; then break; fi
  rss_kb=$(read_rss_kb "$pid" || echo "0")
  if [[ -z "$rss_kb" ]]; then rss_kb=0; fi
  rss_mb=$(awk -v k="$rss_kb" 'BEGIN{printf "%.2f", k/1024.0}')
  samples+=("$rss_mb")
  printf "%s\t%s MB\n" "$(date +%H:%M:%S)" "$rss_mb"
  sleep "$interval"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Process $pid exited" >&2
    break
  fi
done

count=${#samples[@]}
if [[ "$count" -eq 0 ]]; then
  echo "No samples collected" >&2; exit 1
fi

min=${samples[0]}
max=${samples[0]}
sum=0
for v in "${samples[@]}"; do
  awk -v a="$v" -v b="$min" 'BEGIN{if (a<b) exit 0; else exit 1}' && min="$v"
  awk -v a="$v" -v b="$max" 'BEGIN{if (a>b) exit 0; else exit 1}' && max="$v"
  sum=$(awk -v s="$sum" -v x="$v" 'BEGIN{printf "%.2f", s+x}')
done
avg=$(awk -v s="$sum" -v c="$count" 'BEGIN{printf "%.2f", s/c}')

echo "" >&2
echo "Summary: count=$count min=${min} MB avg=${avg} MB max=${max} MB" >&2


