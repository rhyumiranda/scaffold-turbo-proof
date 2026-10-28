#!/bin/bash
# usage: ac53run.sh <outdir> <run>   env: API_URL. Polls /health/live and /health/ready every 500 ms while PostgreSQL is stopped and started.
out="$1"; n="$2"; ep() { date +%s.%N; }
python3 "$DRO_DIR/poll_health.py" "$out/timeline-$n.jsonl" 45 "$API_URL/health/live" "$API_URL/health/ready" & pp=$!
ev="$out/events-$n.txt"; : > "$ev"
sleep 5
echo "stop_begin $(ep)" >> "$ev"; docker stop dro-pg > /dev/null; echo "stop_end $(ep)" >> "$ev"
sleep 12
echo "start_begin $(ep)" >> "$ev"; docker start dro-pg > /dev/null; echo "start_end $(ep)" >> "$ev"
until docker exec dro-pg pg_isready -U postgres -q; do sleep 0.1; done
echo "pg_accepting $(ep)" >> "$ev"
wait "$pp"
