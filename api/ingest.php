<?php
// Adatfogadó végpont az iPhone Parancsok (Shortcuts) automatizmusnak.
// Hitelesítés: "X-Token" fejléc (vagy "token" mező) = a Beállítások oldalon látható kulcs.

declare(strict_types=1);

require __DIR__ . '/../lib.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Csak POST kérést fogadok.']);
}

// Az URL-ben (GET) nem fogadjuk el a kulcsot, mert az a szerver- és proxynaplókba is bekerülne.
$token = $_SERVER['HTTP_X_TOKEN'] ?? ($_POST['token'] ?? '');
$expected = (string) setting('api_token', '');
if ($expected === '' || !is_string($token) || !hash_equals($expected, trim($token))) {
    respond(401, ['ok' => false, 'error' => 'Hibás vagy hiányzó kulcs (X-Token).']);
}

// A Parancsok app háromféleképp küldhet törzset: űrlap ("data" mező), JSON, vagy nyers szöveg/fájl.
// Ha az űrlapmező neve elírás (pl. "Data", "szöveg"), és csak egy mező jött, azt használjuk.
$formFields = array_filter($_POST, function ($v, $k) {
    return is_string($v) && $k !== 'token';
}, ARRAY_FILTER_USE_BOTH);
$text = null;
if (isset($_POST['dates'], $_POST['values']) && is_string($_POST['dates']) && is_string($_POST['values'])) {
    // Ismétlés nélküli Parancs: a dátumok és az értékek külön listában (soronként) jönnek,
    // ezeket párosítjuk össze "típus;dátum;érték" sorokká.
    $type = trim((string) ($_POST['type'] ?? 'glucose')) ?: 'glucose';
    $split = function (string $s): array {
        return array_values(array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $s)), 'strlen'));
    };
    $dates = $split($_POST['dates']);
    $values = $split($_POST['values']);
    if (count($dates) !== count($values)) {
        respond(400, [
            'ok' => false,
            'error' => 'A dátumok (' . count($dates) . ') és az értékek (' . count($values) . ') száma nem egyezik.',
        ]);
    }
    $out = [];
    foreach ($dates as $i => $d) {
        $out[] = $type . ';' . $d . ';' . $values[$i];
    }
    $text = implode("\n", $out);
    $formFields = [];
} elseif (isset($_POST['data']) && is_string($_POST['data'])) {
    $text = $_POST['data'];
} elseif (count($formFields) === 1) {
    $text = (string) reset($formFields);
} elseif (isset($_FILES['data']['tmp_name']) && is_uploaded_file($_FILES['data']['tmp_name'])) {
    $text = (string) file_get_contents($_FILES['data']['tmp_name']);
}

if ($text !== null) {
    $parsed = parse_text_lines($text);
} else {
    $body = (string) file_get_contents('php://input');
    $trimmed = ltrim($body);
    if ($trimmed !== '' && ($trimmed[0] === '{' || $trimmed[0] === '[')) {
        $json = json_decode($body, true);
        if (!is_array($json)) {
            respond(400, ['ok' => false, 'error' => 'Hibás JSON.']);
        }
        $parsed = parse_json_payload($json);
    } else {
        $text = $body;
        $parsed = parse_text_lines($body);
    }
}

// Hibakereséshez: hány sor jött, és mi volt az első (így látszik, ha üres adat érkezik).
$lines = $text !== null ? array_values(array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $text)), 'strlen')) : [];
$received = $text !== null ? count($lines) : count($parsed['rows']) + count($parsed['errors']);
$firstLine = $lines ? mb_substr_safe($lines[0], 120) : null;

[$inserted, $duplicates] = store_rows($parsed['rows']);
record_ingest('api', $inserted, $duplicates, $parsed['errors'], $received, $firstLine);

$response = [
    'ok' => true,
    'received_lines' => $received,
    'inserted' => $inserted,
    'duplicates' => $duplicates,
    'rejected' => count($parsed['errors']),
    'errors' => array_slice($parsed['errors'], 0, 10),
];
if ($firstLine !== null) {
    $response['first_line'] = $firstLine;
}
if ($received === 0) {
    $response['hint'] = $formFields || $_FILES
        ? 'Üres adat érkezett. Ellenőrizd, hogy a "data" mező értéke az Egyesített szöveg legyen. Kapott mezők: ' . implode(', ', array_keys($formFields + $_FILES))
        : 'Üres adat érkezett. A keresés nem talált mérést az adott időszakban, vagy a kérés törzse nem Űrlap "data" mezővel megy.';
}
respond(200, $response);
