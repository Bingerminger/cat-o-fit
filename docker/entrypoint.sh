#!/bin/sh
# =============================================================================
# Cat-O-Fit entrypoint: gets the data/ volume ready.
# - Make sure the data/.htaccess protection is in place (also on fresh bind mounts).
# - Set write permissions for the Apache user (www-data).
# - Optional (CATOFIT_BASIC_AUTH=1): sign-in in front of the whole app via Basic Auth,
#   credentials from CATOFIT_AUTH_USER / CATOFIT_AUTH_PASSWORD. Without the variable
#   the container behaves as before.
# After that the normal Apache start of the base image takes over.
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
    # bcrypt hash via PHP (no extra package needed); Apache 2.4 understands $2y$.
    php -r 'echo getenv("CATOFIT_AUTH_USER"), ":", password_hash(getenv("CATOFIT_AUTH_PASSWORD"), PASSWORD_BCRYPT), "\n";' > "$PASSWD"
    chown root:www-data "$PASSWD"
    chmod 640 "$PASSWD"
    # Exceptions: the container health check (local) and the health intake, which is protected
    # by its own key (Health Auto Export).
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

# Time zone: TZ (e.g. -e TZ=America/New_York) also applies to PHP – previously PHP stayed fixed
# on Europe/Berlin. The calendar files read TZ themselves (api/icstz.php).
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
