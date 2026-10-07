<?php
// Apple Health teljes export (export.xml) betöltése parancssorból.
// Használat: php import_health_export.php <export.xml> [kezdő dátum, pl. 2026-01-01]
// Csak a glükóz-, inzulin- és szénhidrát-rekordokat olvassa be, a többit átugorja.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Csak parancssorból futtatható.');
}

require __DIR__ . '/lib.php';

$file = $argv[1] ?? '';
if ($file === '' || !is_file($file)) {
    fwrite(STDERR, "Használat: php import_health_export.php <export.xml> [kezdő dátum]\n");
    exit(1);
}
$since = isset($argv[2]) ? strtotime($argv[2]) : 0;

$types = [
    'HKQuantityTypeIdentifierBloodGlucose' => 'glucose',
    'HKQuantityTypeIdentifierInsulinDelivery' => 'insulin',
    'HKQuantityTypeIdentifierDietaryCarbohydrates' => 'carbs',
];

$reader = new XMLReader();
if (!$reader->open($file)) {
    fwrite(STDERR, "Nem sikerült megnyitni: $file\n");
    exit(1);
}

$batch = [];
$errors = [];
$totalInserted = 0;
$totalDup = 0;
$seen = 0;

$flush = function () use (&$batch, &$totalInserted, &$totalDup) {
    if ($batch) {
        [$ins, $dup] = store_rows($batch);
        $totalInserted += $ins;
        $totalDup += $dup;
        $batch = [];
    }
};

while ($reader->read()) {
    if ($reader->nodeType !== XMLReader::ELEMENT || $reader->name !== 'Record') {
        continue;
    }
    $hkType = (string) $reader->getAttribute('type');
    if (!isset($types[$hkType])) {
        continue;
    }
    $date = (string) $reader->getAttribute('startDate');
    if ($since && strtotime($date) < $since) {
        continue;
    }
    $subtype = '';
    if ($types[$hkType] === 'insulin') {
        // A HKInsulinDeliveryReason metaadat: 1 = bázis, 2 = bólus.
        $node = $reader->expand();
        if ($node) {
            foreach ($node->childNodes as $child) {
                if ($child instanceof DOMElement && $child->getAttribute('key') === 'HKInsulinDeliveryReason') {
                    $subtype = $child->getAttribute('value');
                }
            }
        }
    }
    $r = normalize_row(
        $types[$hkType],
        $date,
        (string) $reader->getAttribute('value'),
        (string) $reader->getAttribute('unit'),
        (string) $reader->getAttribute('sourceName'),
        $subtype
    );
    $seen++;
    if (is_string($r)) {
        $errors[] = $r;
    } else {
        $batch[] = $r;
        if (count($batch) >= 2000) {
            $flush();
            echo "\r$seen rekord feldolgozva…";
        }
    }
}
$flush();
$reader->close();

record_ingest('Apple Health export', $totalInserted, $totalDup, $errors);

echo "\rKész: $seen rekord, $totalInserted új, $totalDup már megvolt, " . count($errors) . " hibás.\n";
foreach (array_slice($errors, 0, 10) as $e) {
    echo "  - $e\n";
}
