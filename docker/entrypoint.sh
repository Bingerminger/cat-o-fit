#!/bin/sh
# =============================================================================
# Cat-O-Fit-Entrypoint: macht das data/-Volume startklar.
# - data/.htaccess-Schutz sicherstellen (auch bei frischen Bind-Mounts).
# - Schreibrechte für den Apache-Nutzer (www-data) setzen.
# Danach übernimmt der normale Apache-Start des Basis-Images.
# =============================================================================
set -e

DATA=/var/www/html/data

mkdir -p "$DATA"
[ -f "$DATA/.htaccess" ] || cp /opt/cat-o-fit-data-htaccess "$DATA/.htaccess"
chown -R www-data:www-data "$DATA"

exec docker-php-entrypoint "$@"
