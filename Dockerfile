# =============================================================================
# Cat-O-Fit — Docker-Image (Multi-Arch: linux/amd64 + linux/arm64)
#
# Apache + PHP in einem Container. Die JSON-Daten leben im Volume unter
# /var/www/html/data (siehe docker-compose.yml). Der Container startet bewusst
# mit LEERER Instanz: Beim ersten Aufruf führt die App durch die
# Ersteinrichtung (Admin anlegen, optional Demodaten laden).
# =============================================================================
FROM php:8.4-apache

# zip für ZIP-Uploads des Apple-Health-Exports (XMLReader ist bereits enthalten).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libzip-dev \
    && docker-php-ext-install -j"$(nproc)" zip \
    && rm -rf /var/lib/apt/lists/*

# Apache: .htaccess-Regeln der App aktivieren (MIME-Typen für ES-Module,
# Cache-Control, data/-Schutz) + data/ zusätzlich serverseitig fest sperren.
COPY docker/apache.conf /etc/apache2/conf-available/cat-o-fit.conf
RUN a2enmod headers && a2enconf cat-o-fit

# PHP-Laufzeitwerte (Upload-Limits für den Health-Import, Zeitzone für .ics).
COPY docker/php.ini /usr/local/etc/php/conf.d/cat-o-fit.ini

# App-Dateien (.dockerignore hält Doku, Tests, Werkzeuge und Demo-Seeds draußen).
COPY . /var/www/html/

# data/.htaccess für Bind-Mounts beiseitelegen, die ohne den Schutz starten;
# das docker/-Verzeichnis gehört nicht in den Webroot.
RUN cp /var/www/html/data/.htaccess /opt/cat-o-fit-data-htaccess \
    && rm -rf /var/www/html/docker

COPY docker/healthcheck.php /usr/local/bin/cat-o-fit-healthcheck.php
COPY docker/entrypoint.sh /usr/local/bin/cat-o-fit-entrypoint.sh
RUN chmod +x /usr/local/bin/cat-o-fit-entrypoint.sh

VOLUME /var/www/html/data
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["php", "/usr/local/bin/cat-o-fit-healthcheck.php"]

LABEL org.opencontainers.image.title="Cat-O-Fit" \
      org.opencontainers.image.description="Fitness-, Health- & Trainings-PWA für Team und Familie – selbst gehostet, ohne Datenbank." \
      org.opencontainers.image.source="https://github.com/Bingerminger/cat-o-fit" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/usr/local/bin/cat-o-fit-entrypoint.sh"]
CMD ["apache2-foreground"]
