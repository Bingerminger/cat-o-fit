#!/bin/sh
# =============================================================================
# Cat-O-Fit-Entrypoint: macht das data/-Volume startklar.
# - data/.htaccess-Schutz sicherstellen (auch bei frischen Bind-Mounts).
# - Schreibrechte für den Apache-Nutzer (www-data) setzen.
# - Optional (CATOFIT_BASIC_AUTH=1): Anmeldung vor der ganzen App per Basic-Auth,
#   Zugangsdaten aus CATOFIT_AUTH_USER / CATOFIT_AUTH_PASSWORD. Ohne die Variable
#   verhält sich der Container wie bisher.
# Danach übernimmt der normale Apache-Start des Basis-Images.
# =============================================================================
set -e

DATA=/var/www/html/data

mkdir -p "$DATA"
[ -f "$DATA/.htaccess" ] || cp /opt/cat-o-fit-data-htaccess "$DATA/.htaccess"
chown -R www-data:www-data "$DATA"

AUTH_CONF=/etc/apache2/conf-enabled/zz-cat-o-fit-auth.conf
PASSWD=/etc/apache2/cat-o-fit.passwd
case "${CATOFIT_BASIC_AUTH:-}" in
  1|true|yes|on)
    if [ -z "${CATOFIT_AUTH_USER:-}" ] || [ -z "${CATOFIT_AUTH_PASSWORD:-}" ]; then
      echo "CATOFIT_BASIC_AUTH is set, but CATOFIT_AUTH_USER/CATOFIT_AUTH_PASSWORD are missing – start aborted." >&2
      exit 1
    fi
    # bcrypt-Hash über PHP (kein zusätzliches Paket nötig); Apache 2.4 versteht $2y$.
    php -r 'echo getenv("CATOFIT_AUTH_USER"), ":", password_hash(getenv("CATOFIT_AUTH_PASSWORD"), PASSWORD_BCRYPT), "\n";' > "$PASSWD"
    chown root:www-data "$PASSWD"
    chmod 640 "$PASSWD"
    # Ausnahmen: der Container-Healthcheck (lokal) und der Health-Eingang, der mit
    # seinem eigenen Schlüssel geschützt ist (Health Auto Export).
    cat > "$AUTH_CONF" <<'EOF'
<Location />
    AuthType Basic
    AuthName "Cat-O-Fit"
    AuthBasicProvider file
    AuthUserFile /etc/apache2/cat-o-fit.passwd
    <RequireAny>
        Require ip 127.0.0.1 ::1
        Require expr "%{QUERY_STRING} =~ /(^|&)action=health-ingest(&|$)/"
        Require valid-user
    </RequireAny>
</Location>
EOF
    echo "Cat-O-Fit: sign-in in front of the app (Basic Auth) is active."
    ;;
  *)
    rm -f "$AUTH_CONF" "$PASSWD"
    ;;
esac

# Zeitzone: TZ (z. B. -e TZ=America/New_York) gilt auch für PHP – vorher blieb PHP fest
# auf Europe/Berlin. Die Kalender-Dateien lesen TZ selbst (api/icstz.php).
TZ_INI=/usr/local/etc/php/conf.d/zz-cat-o-fit-tz.ini
if [ -n "${TZ:-}" ] && php -r 'exit(in_array(getenv("TZ"), timezone_identifiers_list(), true) ? 0 : 1);'; then
  printf 'date.timezone = %s\n' "$TZ" > "$TZ_INI"
else
  rm -f "$TZ_INI"
  if [ -n "${TZ:-}" ]; then
    echo "Cat-O-Fit: TZ=${TZ} is not a valid time zone – staying with Europe/Berlin." >&2
  fi
fi

exec docker-php-entrypoint "$@"
