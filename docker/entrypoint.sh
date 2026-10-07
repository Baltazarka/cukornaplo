#!/bin/sh
# Az Apache (www-data) a PUID/PGID felhasználóként fut, így a csatolt adatmappa
# fájljai a gazdagépen is ehhez a felhasználóhoz tartoznak (mint a linuxserver.io image-eknél).
set -e
if [ -n "$PGID" ]; then
    groupmod -o -g "$PGID" www-data
fi
if [ -n "$PUID" ]; then
    usermod -o -u "$PUID" www-data
fi
mkdir -p "${DATA_DIR:-/data}"
chown -R www-data:www-data "${DATA_DIR:-/data}"

# CareLink lekérés a háttérben, CARELINK_INTERVAL másodpercenként (alapból 5 perc).
# Ha nincs CareLink kapcsolat beállítva, a szkript azonnal kilép.
(
    sleep 20
    while true; do
        su -s /bin/sh -p www-data -c "php /var/www/html/carelink_poll.php" || true
        sleep "${CARELINK_INTERVAL:-300}"
    done
) &

exec docker-php-entrypoint "$@"
