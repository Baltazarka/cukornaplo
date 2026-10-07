<?php
// Napi nézet: glükózgörbe, inzulin, szénhidrát, napló és 14 napos összesítő.

declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/layout.php';
require __DIR__ . '/carelink.php';

require_login();
cl_poll_if_stale();

$tz = new DateTimeZone('Europe/Budapest');
$dateParam = (string) ($_GET['date'] ?? '');
$day = DateTime::createFromFormat('!Y-m-d', $dateParam, $tz) ?: new DateTime('today', $tz);
$dayStart = $day->getTimestamp();
$dayEnd = (clone $day)->modify('+1 day')->getTimestamp();
$rangeStart = (clone $day)->modify('-13 days')->getTimestamp();

$stmt = db()->prepare('SELECT type, ts, value, subtype, source FROM entries WHERE ts >= ? AND ts < ? ORDER BY ts');
$stmt->execute([$rangeStart, $dayEnd]);

$dayRows = ['glucose' => [], 'insulin' => [], 'carbs' => []];
$daily = [];   // 'Y-m-d' => ['glucose' => [], 'insulin' => 0, 'carbs' => 0]
$allGlucose = [];
foreach ($stmt as $r) {
    $ts = (int) $r['ts'];
    $v = (float) $r['value'];
    $key = date('Y-m-d', $ts);
    if (!isset($daily[$key])) {
        $daily[$key] = ['glucose' => [], 'insulin' => 0.0, 'carbs' => 0.0, 'doses' => 0];
    }
    if ($r['type'] === 'glucose') {
        $daily[$key]['glucose'][] = $v;
        $allGlucose[] = $v;
    } elseif ($r['type'] === 'insulin') {
        $daily[$key]['insulin'] += $v;
        $daily[$key]['doses']++;
    } else {
        $daily[$key]['carbs'] += $v;
    }
    if ($ts >= $dayStart) {
        $dayRows[$r['type']][] = ['ts' => $ts, 'v' => $v, 'sub' => $r['subtype'], 'src' => $r['source']];
    }
}

$dayKey = $day->format('Y-m-d');
$dayStats = glucose_stats(array_column($dayRows['glucose'], 'v'));
$rangeStats = glucose_stats($allGlucose);
$dayInsulin = array_sum(array_column($dayRows['insulin'], 'v'));
$dayCarbs = array_sum(array_column($dayRows['carbs'], 'v'));
$coverage = $dayStats['n'] ? min(100, 100 * $dayStats['n'] / 288) : 0;

// Napló: inzulin és CH időrendben, mellé a legközelebbi (±10 perc) glükózérték.
$events = [];
foreach (['insulin', 'carbs'] as $type) {
    foreach ($dayRows[$type] as $e) {
        $events[] = $e + ['type' => $type];
    }
}
usort($events, function ($a, $b) {
    return $a['ts'] <=> $b['ts'] ?: strcmp($a['type'], $b['type']);
});
$nearestGlucose = function (int $ts) use ($dayRows) {
    $best = null;
    $bestDiff = 601;
    foreach ($dayRows['glucose'] as $g) {
        $d = abs($g['ts'] - $ts);
        if ($d < $bestDiff) {
            $best = $g['v'];
            $bestDiff = $d;
        }
    }
    return $best;
};

$prev = (clone $day)->modify('-1 day')->format('Y-m-d');
$next = (clone $day)->modify('+1 day')->format('Y-m-d');
$today = (new DateTime('today', $tz))->format('Y-m-d');
$huDays = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
$dayLabel = $day->format('Y. m. d.') . ', ' . $huDays[(int) $day->format('w')];

$chartData = [
    'dayStart' => $dayStart * 1000,
    'dayEnd' => $dayEnd * 1000,
    'range' => ['low' => RANGE_LOW, 'high' => RANGE_HIGH],
    'glucose' => array_map(function ($g) {
        return [$g['ts'] * 1000, $g['v']];
    }, $dayRows['glucose']),
    'insulin' => array_map(function ($e) {
        return [$e['ts'] * 1000, $e['v'], $e['sub']];
    }, $dayRows['insulin']),
    'carbs' => array_map(function ($e) {
        return [$e['ts'] * 1000, $e['v']];
    }, $dayRows['carbs']),
];

$bandLabels = [
    'veryHigh' => ['Nagyon magas', '> 13,9'],
    'high' => ['Magas', '10,1–13,9'],
    'inRange' => ['Céltartomány', '3,9–10,0'],
    'low' => ['Alacsony', '3,0–3,8'],
    'veryLow' => ['Nagyon alacsony', '< 3,0'],
];

function tir_bar(array $stats, array $bandLabels, string $title): void
{
    if (!$stats['n']) {
        echo '<p class="muted">' . h($title) . ': nincs glükózadat.</p>';
        return;
    }
    echo '<div class="tir"><div class="tir-title">' . h($title) . '</div><div class="tir-row"><div class="tir-bar" role="img" aria-label="' . h($title) . ' megoszlás">';
    foreach ($bandLabels as $k => $_) {
        $p = $stats['pct'][$k];
        if ($p > 0) {
            echo '<span class="seg seg-' . $k . '" style="flex-basis:' . number_format($p, 2, '.', '') . '%"></span>';
        }
    }
    echo '</div><ul class="tir-legend">';
    foreach ($bandLabels as $k => [$name, $range]) {
        echo '<li><span class="key seg-' . $k . '"></span><span>' . h($name) . ' <span class="muted">' . h($range) . '</span></span><b>' . fmt($stats['pct'][$k], 0) . '%</b></li>';
    }
    echo '</ul></div></div>';
}

page_header($dayLabel, 'day');
?>
<form class="filters" method="get">
  <a class="btn ghost" href="?date=<?= h($prev) ?>" aria-label="Előző nap">←</a>
  <input type="date" name="date" value="<?= h($dayKey) ?>" max="<?= h($today) ?>" onchange="this.form.submit()">
  <a class="btn ghost" href="?date=<?= h($next) ?>" aria-label="Következő nap" <?= $dayKey >= $today ? 'hidden' : '' ?>>→</a>
  <?php if ($dayKey !== $today): ?><a class="btn ghost" href="?date=<?= h($today) ?>">Ma</a><?php endif; ?>
  <h1><?= h($dayLabel) ?></h1>
</form>

<?php if (!$dayStats['n'] && !$events): ?>
<section class="card empty">
  <p>Erre a napra nincs adat.</p>
  <p class="muted">Ha még nem állítottad be az iPhone-os küldést, a <a href="setup.php?step=2">Telefon beállítása</a> oldal lépésről lépésre végigvezet.</p>
</section>
<?php endif; ?>

<section class="tiles">
  <div class="tile"><div class="tile-label">Átlag glükóz</div><div class="tile-value"><?= $dayStats['n'] ? fmt($dayStats['avg']) : '–' ?> <small>mmol/L</small></div></div>
  <div class="tile"><div class="tile-label">Céltartományban</div><div class="tile-value"><?= $dayStats['n'] ? fmt($dayStats['pct']['inRange'], 0) : '–' ?> <small>%</small></div></div>
  <div class="tile"><div class="tile-label">Alacsony (&lt; 3,9)</div><div class="tile-value"><?= $dayStats['n'] ? fmt($dayStats['pct']['low'] + $dayStats['pct']['veryLow'], 0) : '–' ?> <small>%</small></div></div>
  <div class="tile"><div class="tile-label">Összes inzulin</div><div class="tile-value"><?= fmt($dayInsulin) ?> <small>E</small></div></div>
  <div class="tile"><div class="tile-label">Összes szénhidrát</div><div class="tile-value"><?= fmt($dayCarbs, 0) ?> <small>g</small></div></div>
  <div class="tile"><div class="tile-label">Szenzoradat</div><div class="tile-value"><?= fmt($coverage, 0) ?> <small>%</small></div></div>
</section>

<section class="card charts">
  <div class="chart-block">
    <div class="chart-head"><h2>Glükóz <span class="muted">mmol/L</span></h2><span class="muted legend-note"><span class="band-key"></span> céltartomány 3,9–10,0 · <span class="low-key"></span> 3,9 alatt</span></div>
    <div class="chart-box tall"><canvas id="chart-glucose" aria-label="Glükózgörbe"></canvas></div>
  </div>
  <div class="chart-block">
    <div class="chart-head"><h2>Inzulin <span class="muted">E</span></h2><span class="muted legend-note" id="insulin-legend"></span></div>
    <div class="chart-box short"><canvas id="chart-insulin" aria-label="Inzulinadagok"></canvas></div>
  </div>
  <div class="chart-block">
    <div class="chart-head"><h2>Szénhidrát <span class="muted">g</span></h2></div>
    <div class="chart-box short"><canvas id="chart-carbs" aria-label="Szénhidrát"></canvas></div>
  </div>
</section>

<div class="grid2">
  <section class="card">
    <h2>Napló</h2>
    <?php if ($events): ?>
    <table class="table">
      <thead><tr><th>Idő</th><th>Esemény</th><th class="num">Mennyiség</th><th class="num">Glükóz</th></tr></thead>
      <tbody>
      <?php foreach ($events as $e):
          $g = $nearestGlucose($e['ts']);
          $label = $e['type'] === 'carbs' ? 'Szénhidrát' : ($e['sub'] === 'basal' ? 'Bázisinzulin' : 'Inzulin');
          ?>
        <tr>
          <td class="num"><?= date('H:i', $e['ts']) ?></td>
          <td><span class="dot dot-<?= h($e['type'] === 'insulin' && $e['sub'] === 'basal' ? 'basal' : $e['type']) ?>"></span><?= h($label) ?></td>
          <td class="num"><?= $e['type'] === 'carbs' ? fmt($e['v'], 0) . ' g' : fmt($e['v']) . ' E' ?></td>
          <td class="num"><?= $g !== null ? fmt($g) : '–' ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php else: ?>
    <p class="muted">Erre a napra nincs inzulin- vagy CH-bejegyzés.</p>
    <?php endif; ?>
  </section>

  <section class="card">
    <h2>Idő a tartományokban</h2>
    <?php tir_bar($dayStats, $bandLabels, 'Ez a nap'); ?>
    <?php tir_bar($rangeStats, $bandLabels, 'Utolsó 14 nap'); ?>
    <?php if ($rangeStats['n']): ?>
    <dl class="facts">
      <div><dt>14 napos átlag</dt><dd><?= fmt($rangeStats['avg']) ?> mmol/L</dd></div>
      <div><dt>GMI (becsült HbA1c)</dt><dd><?= fmt($rangeStats['gmi']) ?>%</dd></div>
      <div><dt>Variabilitás (CV)</dt><dd><?= fmt($rangeStats['cv'], 0) ?>%</dd></div>
    </dl>
    <p class="muted small">A GMI csak legalább 14 napnyi, jó lefedettségű szenzoradatból megbízható.</p>
    <?php endif; ?>
  </section>
</div>

<section class="card">
  <h2>Utolsó 14 nap</h2>
  <div class="table-wrap">
  <table class="table">
    <thead><tr><th>Nap</th><th class="num">Átlag</th><th class="num">Célban</th><th class="num">Alacsony</th><th class="num">Inzulin</th><th class="num">Adag</th><th class="num">CH</th></tr></thead>
    <tbody>
    <?php for ($i = 0; $i < 14; $i++):
        $d = (clone $day)->modify("-$i days");
        $k = $d->format('Y-m-d');
        $row = $daily[$k] ?? null;
        $s = $row ? glucose_stats($row['glucose']) : ['n' => 0];
        ?>
      <tr class="<?= $k === $dayKey ? 'current' : '' ?>">
        <td><a href="?date=<?= h($k) ?>"><?= h($d->format('m. d.')) ?> <span class="muted"><?= h(mb_substr_safe($huDays[(int) $d->format('w')], 3)) ?></span></a></td>
        <td class="num"><?= $s['n'] ? fmt($s['avg']) : '–' ?></td>
        <td class="num"><?= $s['n'] ? fmt($s['pct']['inRange'], 0) . '%' : '–' ?></td>
        <td class="num"><?= $s['n'] ? fmt($s['pct']['low'] + $s['pct']['veryLow'], 0) . '%' : '–' ?></td>
        <td class="num"><?= $row && $row['insulin'] ? fmt($row['insulin']) . ' E' : '–' ?></td>
        <td class="num"><?= $row && $row['doses'] ? $row['doses'] : '–' ?></td>
        <td class="num"><?= $row && $row['carbs'] ? fmt($row['carbs'], 0) . ' g' : '–' ?></td>
      </tr>
    <?php endfor; ?>
    </tbody>
  </table>
  </div>
</section>

<p class="muted small disclaimer">Saját nyilvántartás, nem orvostechnikai eszköz. Kezelési döntéshez a Guardian és az InPen app értékeit használd.</p>

<script>window.DAY = <?= json_encode($chartData) ?>;</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script src="<?= h(app_path()) ?>/assets/app.js?v=2"></script>
<?php
page_footer();
