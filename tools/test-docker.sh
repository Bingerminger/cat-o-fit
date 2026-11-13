#!/bin/bash
# test-docker.sh — smoke test of the Docker image as users run it (Apache, the image's PHP settings,
# the entrypoint): health check, data/ blocked, no PHP errors or server paths in responses, and the
# optional sign-in in front of the app (CATOFIT_BASIC_AUTH) that only lets the health intake pass.
#
#   docker build -t cat-o-fit:smoke . && IMAGE=cat-o-fit:smoke bash tools/test-docker.sh
#
# Starts two throwaway containers on free ports and removes them afterwards. Exit code 0 = all green.
# Runs in CI (.github/workflows/ci.yml, job "Docker image smoke test").
set -uo pipefail

IMAGE="${IMAGE:-cat-o-fit:smoke}"
NAME="catofit-smoke-$$"
USER_="smoke"
PASS="smoke-$$-pass"
pass=0; fail=0

check() {   # check "<name>" <condition-exit-code> [detail]
  if [ "$2" = 0 ]; then pass=$((pass + 1)); echo "  OK  $1"; else fail=$((fail + 1)); echo "  FAILED  $1${3:+  ($3)}"; fi
}
cleanup() { docker rm -f "$NAME-plain" "$NAME-auth" >/dev/null 2>&1 || true; }
trap cleanup EXIT

wait_healthy() {
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)" = healthy ] && return 0
    sleep 1
  done
  return 1
}
# status <url> [curl args…] → HTTP status; body in $BODY, headers in $HEAD
req() {
  local url="$1"; shift
  HEAD="$(mktemp)"
  BODY="$(curl -s -D "$HEAD" "$@" "$url")"
  STATUS="$(head -1 "$HEAD" | awk '{print $2}')"
}
clean_body() { ! printf '%s' "$BODY" | grep -qiE 'fatal error|warning:|uncaught|/var/www'; }

# Free host ports chosen by Docker itself.
docker run -d --name "$NAME-plain" -p 127.0.0.1::80 "$IMAGE" >/dev/null || { echo "Image $IMAGE does not start."; exit 1; }
docker run -d --name "$NAME-auth" -p 127.0.0.1::80 -e CATOFIT_BASIC_AUTH=1 -e CATOFIT_AUTH_USER="$USER_" -e CATOFIT_AUTH_PASSWORD="$PASS" "$IMAGE" >/dev/null || { echo "Image $IMAGE does not start with sign-in."; exit 1; }
P1="$(docker port "$NAME-plain" 80/tcp | head -1 | sed 's/.*://')"
P2="$(docker port "$NAME-auth" 80/tcp | head -1 | sed 's/.*://')"

echo "== Without sign-in in front (default)"
wait_healthy "$NAME-plain"; check "health check healthy" $?
A="http://127.0.0.1:$P1"
req "$A/api/api.php?action=ping"; [ "$STATUS" = 200 ]; check "ping 200" $? "$STATUS"
! grep -qi '^X-Powered-By' "$HEAD"; check "no X-Powered-By header" $?
req "$A/data/.htaccess"; [ "$STATUS" = 403 ] || [ "$STATUS" = 404 ]; check "data/ is not served" $? "$STATUS"
for part in foodfacts.php read-access.php health-ingest.php health-import.php ics.php storage.php auth.php; do
  req "$A/api/$part"; { [ "$STATUS" = 403 ] || [ "$STATUS" = 404 ]; } && clean_body; check "api/$part not reachable, no PHP error" $? "$STATUS"
done
req "$A/api/api.php?action=changes&area[]=sessions&user=u-1&since=0"; [ "$STATUS" = 400 ] && clean_body; check "list parameter: 400 without PHP warning" $? "$STATUS"
req "$A/api/api.php?action=changes&area=x&user=..%2F..&since=0"; [ "$STATUS" -lt 500 ] && clean_body; check "invalid input: no 500, no PHP error" $? "$STATUS"

echo "== With sign-in in front (CATOFIT_BASIC_AUTH=1)"
wait_healthy "$NAME-auth"; check "health check healthy (local ping passes)" $?
B="http://127.0.0.1:$P2"
req "$B/api/api.php?action=ping"; [ "$STATUS" = 401 ]; check "ping from outside without sign-in: 401" $? "$STATUS"
req "$B/"; [ "$STATUS" = 401 ]; check "app without sign-in: 401" $? "$STATUS"
req "$B/api/api.php?action=ping" -u "$USER_:$PASS"; [ "$STATUS" = 200 ]; check "with sign-in: 200" $? "$STATUS"
req "$B/api/api.php?action=changes-all&user=u-1&since=sessions:0" -u "$USER_:$PASS"; [ "$STATUS" = 200 ] || [ "$STATUS" = 400 ]; check "with sign-in: the API answers" $? "$STATUS"
for q in 'action=health-ingest&action=changes-all&user=u-1&since=sessions:0' \
         'action=health-ingest&%61ction=changes-all&user=u-1&since=sessions:0' \
         'action=health-ingest&action%5B%5D=changes-all&user=u-1&since=sessions:0' \
         'action=health-ingest&+action=changes-all&user=u-1&since=sessions:0'; do
  req "$B/api/api.php?$q"; [ "$STATUS" != 200 ] && ! printf '%s' "$BODY" | grep -q '"changes"' && clean_body
  check "without sign-in, a second action does not run ($q)" $? "$STATUS"
done
req "$B/api/api.php?action=health-ingest&action=ops&area=sessions&user=u-1" -X POST -H 'Content-Type: application/json' --data '{"ops":[{"op":"upsert","record":{"id":"smoke"}}]}'
[ "$STATUS" != 200 ]; check "without sign-in, nothing is written via a second action" $? "$STATUS"
req "$B/api/api.php?action=changes&area=sessions&user=u-1&since=0" -u "$USER_:$PASS"
! printf '%s' "$BODY" | grep -q '"smoke"'; check "and nothing arrived" $?
req "$B/api/api.php?action=health-ingest&user=u-1" -X POST -H 'Content-Type: application/json' -H 'X-Catofit-Token: wrong' --data '{"data":{}}'
printf '%s' "$BODY" | grep -q '^{' && ! printf '%s' "$BODY" | grep -q 'basic_auth'; check "the health intake itself is reached (its key decides)" $? "$STATUS"

echo
echo "docker: $pass ok, $fail failed"
[ "$fail" = 0 ]
