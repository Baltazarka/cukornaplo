# A közzétett baltazarka/cukornaplo image build-lépései alapján visszaállítva.
FROM php:8.3-apache

RUN a2enmod rewrite headers \
 && mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

COPY docker/php.ini /usr/local/etc/php/conf.d/zz-cukornaplo.ini
COPY docker/apache.conf /etc/apache2/conf-available/zz-cukornaplo.conf
COPY docker/entrypoint.sh /usr/local/bin/cukornaplo-entrypoint
RUN a2enconf zz-cukornaplo \
 && sed -i 's/\r$//' /usr/local/bin/cukornaplo-entrypoint \
 && chmod +x /usr/local/bin/cukornaplo-entrypoint

ENV DATA_DIR=/data APP_TZ=Europe/Budapest TZ=Europe/Budapest CARELINK_POLLER=1
RUN mkdir -p /data && chown www-data:www-data /data
VOLUME ["/data"]

COPY . /var/www/html/
RUN rm -rf /var/www/html/data /var/www/html/docker /var/www/html/Dockerfile /var/www/html/.dockerignore

HEALTHCHECK --interval=1m --timeout=5s --start-period=10s \
  CMD php -r 'exit(@fsockopen("127.0.0.1", 80) ? 0 : 1);'

ENTRYPOINT ["cukornaplo-entrypoint"]
CMD ["apache2-foreground"]
