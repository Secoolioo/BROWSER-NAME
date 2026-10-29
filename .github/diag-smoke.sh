#!/usr/bin/env bash
# Runs the first or the remaining entries of $FORMATS in the background with a watchdog,
# then lists the processes started since the first part (stopping them after the last part).
set -uo pipefail
part=$1
read -r -a all <<<"$FORMATS"
# Without SPLIT, the first part runs every entry back to back, as the regular step does.
if [ "$part" = first ]; then
  date -u +%Y-%m-%dT%H:%M:%SZ >"$RUNNER_TEMP/smoke-since"
  if [ "${SPLIT:-}" = true ]; then
    entries=("${all[0]}")
    stop=0
  else
    entries=("${all[@]}")
    stop=1
  fi
elif [ "${SPLIT:-}" = true ]; then
  entries=("${all[@]:1}")
  stop=1
else
  entries=()
fi
if [ ${#entries[@]} -eq 0 ]; then
  echo "Nothing left to test."
  exit 0
fi
log="$RUNNER_TEMP/smoke-$part.log"
(
  for entry in "${entries[@]}"; do
    format="${entry%%:*}"
    pattern="${entry#*:}"
    file=$(find "$RUNNER_TEMP/packages" -maxdepth 1 -name "$pattern" | sort | head -1)
    echo "== $(date -u +%H:%M:%S) $format $file"
    node tools/package/smoke.ts "$format" "$file" || exit 1
    for browser_log in "${APPDATA:-/none}/Astela/logs/main.log" "$HOME/.config/Astela/logs/main.log" "$HOME/Library/Application Support/Astela/logs/main.log"; do
      if [ -f "$browser_log" ]; then
        echo "== $(date -u +%H:%M:%S) end of $browser_log"
        tail -n 40 "$browser_log"
      fi
    done
  done
) >"$log" 2>&1 &
tests=$!
for _ in $(seq 1 360); do
  kill -0 "$tests" 2>/dev/null || break
  sleep 1
done
if kill -0 "$tests" 2>/dev/null; then
  echo "::error::The smoke tests did not finish within 6 minutes"
fi
if [ "$RUNNER_OS" = Windows ]; then
  SINCE=$(cat "$RUNNER_TEMP/smoke-since") STOP="$stop" /usr/bin/timeout 300 pwsh -NoProfile -File .github/diag-processes.ps1 >"$RUNNER_TEMP/smoke-$part-processes.log" 2>&1 || echo "listing failed: $?"
  cat "$RUNNER_TEMP/smoke-$part-processes.log"
fi
status=0
if kill -0 "$tests" 2>/dev/null; then
  status=1
else
  wait "$tests" || status=$?
fi
cat "$log"
exit "$status"
