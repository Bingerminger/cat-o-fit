# =============================================================================
# Cat-O-Fit — Docker image (multi-arch: linux/amd64 + linux/arm64)
#
# Apache + PHP in one container. The JSON data lives in the volume at
# /var/www/html/data (see docker-compose.yml). The container deliberately starts
# with an EMPTY instance: on first access the app walks you through the
# initial setup (create an admin, optionally load demo data).
# =============================================================================
FROM php:8.4-apache

# zip for ZIP uploads of the Apple Health export (XMLReader is already included),
# opcache for reasonable PHP performance on NAS hardware.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libzip-dev \
    && docker-php-ext-install -j"$(nproc)" zip opcache \
    && rm -rf /var/lib/apt/lists/*

# Time zone (overridable: docker run -e TZ=Europe/Vienna …)
ENV TZ=Europe/Berlin

# Apache: enable the app's .htaccess rules (MIME types for ES modules,
# Cache-Control, data/ protection) + additionally lock down data/ firmly on the server side.
COPY docker/apache.conf /etc/apache2/conf-available/cat-o-fit.conf
RUN a2enmod headers && a2enconf cat-o-fit

# PHP runtime values (upload limits for the Health import, time zone for .ics).
COPY docker/php.ini /usr/local/etc/php/conf.d/cat-o-fit.ini

# App files (.dockerignore keeps docs, tests, tools and demo seeds out).
COPY . /var/www/html/

# Set data/.htaccess aside for bind mounts that start without the protection;
# the docker/ directory does not belong in the web root.
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
      org.opencontainers.image.description="Training planner PWA for the whole family and teams – self-hosted, no database, seven languages." \
      org.opencontainers.image.source="https://github.com/Bingerminger/cat-o-fit" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

ENTRYPOINT ["/usr/local/bin/cat-o-fit-entrypoint.sh"]
CMD ["apache2-foreground"]
