<?php
// A beállító varázsló ezzel figyeli, megérkezett-e az első adat.

declare(strict_types=1);

require __DIR__ . '/../lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

start_session();
if (empty($_SESSION['auth'])) {
    http_response_code(401);
    echo json_encode(['ok' => false]);
    exit;
}
session_write_close();

$counts = ['glucose' => 0, 'insulin' => 0, 'carbs' => 0];
foreach (db()->query('SELECT type, COUNT(*) c FROM entries GROUP BY type') as $r) {
    $counts[$r['type']] = (int) $r['c'];
}
$last = setting('last_ingest');

echo json_encode([
    'ok' => true,
    'counts' => $counts,
    'total' => array_sum($counts),
    'last' => $last ? [
        'at' => date('H:i:s', (int) $last['at']),
        'atTs' => (int) $last['at'],
        'via' => $last['via'],
        'inserted' => (int) $last['inserted'],
        'duplicates' => (int) $last['duplicates'],
        'errors' => $last['errors'],
    ] : null,
], JSON_UNESCAPED_UNICODE);
