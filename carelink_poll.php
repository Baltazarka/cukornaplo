<?php
// CareLink lekérés parancssorból. Dockerben az entrypoint 5 percenként futtatja.
// Kézzel: php carelink_poll.php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Csak parancssorból futtatható.');
}

require __DIR__ . '/lib.php';
require __DIR__ . '/carelink.php';

if (!cl_is_connected()) {
    exit(0); // nincs beállítva, nincs teendő
}

$r = cl_poll(); // a cl_poll() maga gondoskodik róla, hogy egyszerre csak egy fusson
$now = date('Y-m-d H:i:s');
if ($r['ok']) {
    $latest = $r['latest'] ? date('H:i', (int) $r['latest']) : '-';
    fwrite(STDOUT, "[$now] CareLink: {$r['received']} érték, {$r['inserted']} új, legutolsó $latest\n");
} else {
    fwrite(STDERR, "[$now] CareLink hiba: {$r['error']}\n");
}
