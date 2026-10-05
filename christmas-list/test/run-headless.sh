#!/usr/bin/env bash
# Runs test/index.html in headless Chrome (or Edge) and prints the results.
# Runs twice: normally, then with "reduce motion" turned on.
#
#   bash christmas-list/test/run-headless.sh            # everything
#   bash christmas-list/test/run-headless.sh db         # just one suite (db / pages / layout)
#
# Needs: Chrome or Edge, and internet (PGlite and fonts load from a CDN).
# Exit code is 0 only if every check passed.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SUITE="${1:-}"

find_browser() {
  for c in \
    "${CHROME:-}" \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$(command -v google-chrome 2>/dev/null)" \
    "$(command -v chromium 2>/dev/null)" \
    "$(command -v chromium-browser 2>/dev/null)"; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return; }
  done
}
BROWSER="$(find_browser)"
[ -z "$BROWSER" ] && { echo "Couldn't find Chrome or Edge. Set CHROME=/path/to/chrome and retry."; exit 2; }

# File URL for the runner (handles Git Bash on Windows too).
if command -v cygpath >/dev/null 2>&1; then
  URL="file:///$(cygpath -m "$HERE/index.html")"
else
  URL="file://$HERE/index.html"
fi
[ -n "$SUITE" ] && URL="$URL?suite=$SUITE"

status=0
for pass in normal reduced-motion; do
  PROFILE="$(mktemp -d)"
  extra=""
  [ "$pass" = "reduced-motion" ] && extra="--force-prefers-reduced-motion"
  echo "=== $pass ==="
  # --allow-file-access-from-files lets the runner read the app's files from disk.
  # --virtual-time-budget fast-forwards the tests' waits so the run finishes quickly.
  "$BROWSER" --headless=new --disable-gpu --no-first-run $extra \
    --allow-file-access-from-files --user-data-dir="$PROFILE" \
    --virtual-time-budget=400000 --dump-dom "$URL" 2>/dev/null \
    | awk '/<div id="frames"/{exit} /<div id="log">/{f=1} f' \
    | sed 's/<div class="[a-z]*">/\n/g; s/<[^>]*>//g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&#39;/'"'"'/g; s/&amp;/\&/g' \
    | sed '/^[[:space:]]*$/d' > "$PROFILE/out.txt"
  if [ "$pass" = "normal" ]; then cat "$PROFILE/out.txt"; else grep -E "FAIL|ERROR|reduced motion|RESULT" "$PROFILE/out.txt"; fi
  grep -qE "^RESULT: PASS [0-9]+$" "$PROFILE/out.txt" || status=1
  rm -rf "$PROFILE" 2>/dev/null
  # Only the layout suite behaves differently with reduced motion.
  { [ -n "$SUITE" ] && [ "$SUITE" != "layout" ]; } && break
done

[ $status -eq 0 ] && echo "ALL PASSED" || echo "SOME CHECKS FAILED"
exit $status
