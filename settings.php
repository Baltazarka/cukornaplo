<?php
// Adatok és import: tárolt adatok, API-kulcs, kézi import.
// A telefon beállításának lépései a setup.php varázslóban vannak.

declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/layout.php';
require __DIR__ . '/carelink.php';

require_login();

// A legutolsó nyers CareLink válasz letöltése (hibakereséshez).
if (isset($_GET['carelink_raw'])) {
    $file = DATA_DIR . '/' . CL_RAW_FILE;
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="carelink_last.json"');
    echo is_file($file) ? file_get_contents($file) : '{}';
    exit;
}

$message = '';
$alert = '';
$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    $action = $_POST['action'] ?? '';
    if ($action === 'cl_connect') {
        try {
            $session = cl_connect_with_code((string) ($_POST['cl_code'] ?? ''));
            $r = cl_poll();
            $message = 'CareLink kapcsolat kész: ' . ($session['name'] ?: $session['username'])
                . ($r['ok'] ? ". Első lekérés: {$r['received']} szenzorérték, {$r['inserted']} új." : '. Az első lekérés hibát adott: ' . $r['error']);
        } catch (Throwable $e) {
            $alert = $e->getMessage();
        }
    } elseif ($action === 'cl_poll') {
        $r = cl_poll();
        if ($r['ok']) {
            $message = "CareLink: {$r['received']} szenzorérték, {$r['inserted']} új"
                . ($r['latest'] ? ', a legfrissebb ' . date('H:i', (int) $r['latest']) . '-kor.' : '.');
        } else {
            $alert = 'CareLink hiba: ' . $r['error'];
        }
    } elseif ($action === 'cl_patient') {
        cl_save(['patient' => (string) ($_POST['patient'] ?? '')]);
        $r = cl_poll();
        $message = $r['ok'] ? "Páciens beállítva. {$r['received']} szenzorérték, {$r['inserted']} új." : '';
        $alert = $r['ok'] ? '' : 'CareLink hiba: ' . $r['error'];
    } elseif ($action === 'cl_disconnect') {
        save_settings(['carelink' => null]);
        @unlink(DATA_DIR . '/' . CL_RAW_FILE);
        $message = 'A CareLink kapcsolat törölve. A már letöltött adatok megmaradnak.';
    } elseif ($action === 'regen_token') {
        save_settings(['api_token' => new_token()]);
        $message = 'Új kulcs készült. A telefonon (Health Auto Export vagy Parancsok) is írd át!';
    } elseif ($action === 'import') {
        $text = (string) ($_POST['lines'] ?? '');
        if (isset($_FILES['file']['tmp_name']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
            $text .= "\n" . file_get_contents($_FILES['file']['tmp_name']);
        }
        $trimmed = ltrim($text);
        $parsed = ($trimmed !== '' && $trimmed[0] === '{')
            ? parse_json_payload((array) json_decode($trimmed, true))
            : parse_text_lines($text);
        [$ins, $dup] = store_rows($parsed['rows']);
        record_ingest('kézi import', $ins, $dup, $parsed['errors']);
        $errors = array_slice($parsed['errors'], 0, 20);
        $message = "Import kész: $ins új bejegyzés, $dup már megvolt, " . count($parsed['errors']) . ' hibás sor.';
    }
}

$token = (string) setting('api_token', '');
$ingestUrl = phone_base_url() . '/api/ingest.php';
$last = setting('last_ingest');

$counts = ['glucose' => [0, null, null], 'insulin' => [0, null, null], 'carbs' => [0, null, null]];
foreach (db()->query('SELECT type, COUNT(*) c, MIN(ts) mn, MAX(ts) mx FROM entries GROUP BY type') as $r) {
    $counts[$r['type']] = [(int) $r['c'], (int) $r['mn'], (int) $r['mx']];
}
$labels = ['glucose' => 'Glükóz', 'insulin' => 'Inzulin', 'carbs' => 'Szénhidrát'];

$cl = cl_state();
$clConnected = cl_is_connected();
$clAuthUrl = '';
$clConfigError = '';
if (!$clConnected) {
    try {
        $clAuthUrl = cl_authorize_url();
    } catch (Throwable $e) {
        $clConfigError = $e->getMessage();
    }
}

page_header('Adatok és import', 'settings');
?>
<?php if ($alert): ?>
<p class="alert"><?= h($alert) ?></p>
<?php endif; ?>
<?php if ($message): ?>
<p class="notice"><?= h($message) ?></p>
<?php endif; ?>
<?php if ($errors): ?>
<details class="card" open><summary>Hibás sorok (első 20)</summary><ul class="errors"><?php foreach ($errors as $e): ?><li><?= h($e) ?></li><?php endforeach; ?></ul></details>
<?php endif; ?>

<section class="card">
  <h2>Tárolt adatok</h2>
  <table class="table">
    <thead><tr><th>Típus</th><th class="num">Bejegyzés</th><th>Első</th><th>Utolsó</th></tr></thead>
    <tbody>
    <?php foreach ($counts as $type => [$c, $mn, $mx]): ?>
      <tr>
        <td><?= h($labels[$type]) ?></td>
        <td class="num"><?= $c ?></td>
        <td><?= $mn ? date('Y.m.d. H:i', $mn) : '–' ?></td>
        <td><?= $mx ? date('Y.m.d. H:i', $mx) : '–' ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>
  <p class="muted">
    Utolsó adatfogadás:
    <?php if ($last): ?>
      <?= date('Y.m.d. H:i', (int) $last['at']) ?> (<?= h($last['via']) ?>):
      <?= isset($last['received']) ? (int) $last['received'] . ' sor érkezett, ' : '' ?>
      <?= (int) $last['inserted'] ?> új, <?= (int) $last['duplicates'] ?> már megvolt<?= $last['errors'] ? ', hibák: ' . h(implode(' · ', $last['errors'])) : '' ?>
      <?php if (!empty($last['first_line'])): ?><br>Első sor: <code><?= h($last['first_line']) ?></code><?php endif; ?>
    <?php else: ?>
      még nem érkezett adat.
    <?php endif; ?>
  </p>
</section>

<section class="card guide" id="carelink">
  <h2>CareLink: folyamatos szenzorgörbe</h2>
  <?php if ($clConnected):
      $sess = $cl['session'] ?? [];
      $patients = $sess['patients'] ?? [];
      ?>
  <table class="table form-map">
    <tr><td>Fiók</td><td><?= h(($sess['name'] ?? '') ?: ($sess['username'] ?? '–')) ?> <span class="muted">(<?= h($sess['role'] ?? '') ?>)</span></td></tr>
    <?php if ($patients): ?>
    <tr><td>Követett páciens</td><td>
      <?php if (count($patients) > 1): ?>
      <form method="post" class="inline-form">
        <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
        <input type="hidden" name="action" value="cl_patient">
        <select name="patient" onchange="this.form.submit()">
          <?php foreach ($patients as $p): ?>
          <option value="<?= h($p['username']) ?>" <?= ($cl['patient'] ?? $patients[0]['username']) === $p['username'] ? 'selected' : '' ?>><?= h($p['name'] ?: $p['username']) ?> (<?= h($p['device']) ?>)</option>
          <?php endforeach; ?>
        </select>
      </form>
      <?php else: ?>
      <?= h($patients[0]['name'] ?: $patients[0]['username']) ?> <span class="muted">(<?= h($patients[0]['device']) ?>)</span>
      <?php endif; ?>
    </td></tr>
    <?php endif; ?>
    <tr><td>Utolsó lekérés</td><td><?= !empty($cl['last_poll_at']) ? date('Y.m.d. H:i', (int) $cl['last_poll_at']) : '–' ?></td></tr>
    <tr><td>Utolsó sikeres</td><td><?= !empty($cl['last_ok_at']) ? date('Y.m.d. H:i', (int) $cl['last_ok_at']) . ' · ' . (int) ($cl['last_count'] ?? 0) . ' érték, ' . (int) ($cl['last_inserted'] ?? 0) . ' új' : '–' ?></td></tr>
    <tr><td>Legfrissebb érték</td><td><?= !empty($cl['last_sg_at']) ? date('Y.m.d. H:i', (int) $cl['last_sg_at']) : '–' ?></td></tr>
    <?php if (!empty($cl['last_error'])): ?>
    <tr><td>Hiba</td><td class="err-text"><?= h($cl['last_error']) ?> <span class="muted">(<?= date('H:i', (int) ($cl['last_error_at'] ?? time())) ?>)</span></td></tr>
    <?php endif; ?>
  </table>
  <p class="muted small">A szerver <?= getenv('CARELINK_POLLER') === '1' ? '5 percenként magától lekéri' : 'a napi nézet megnyitásakor lekéri' ?> az új értékeket.</p>
  <div class="btn-row">
    <form method="post"><input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>"><input type="hidden" name="action" value="cl_poll"><button type="submit">Lekérés most</button></form>
    <a class="btn ghost" href="?carelink_raw=1">Nyers válasz letöltése</a>
    <form method="post" onsubmit="return confirm('Biztos törlöd a CareLink kapcsolatot? A letöltött adatok megmaradnak.')"><input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>"><input type="hidden" name="action" value="cl_disconnect"><button type="submit" class="ghost">Kapcsolat bontása</button></form>
  </div>
  <?php elseif ($clConfigError): ?>
  <p class="alert"><?= h($clConfigError) ?></p>
  <?php else: ?>
  <?php if (!empty($cl['last_error'])): ?>
  <p class="alert"><?= h($cl['last_error']) ?></p>
  <?php endif; ?>
  <p>A Guardian app élőben tölt fel a CareLinkbe. Ha itt beállítod a <b>gondozói (care partner) fiókodat</b>, a szerver onnan 5 percenként lekéri a szenzorértékeket.</p>
  <p class="muted small">Nem hivatalos módszer (ugyanaz, mint az xDrip+ CareLink Follower). Ha a Medtronic változtat a rendszerén, elromolhat. A gondozói fiókban a kétlépcsős azonosítás (MFA) legyen kikapcsolva. A jelszavad nem kerül ide, csak egy belépési kulcs.</p>
  <ol class="steps">
    <li><b>Számítógépen</b>, Chrome-ban vagy Edge-ben nyiss egy új lapot, nyomd meg az <b>F12</b>-t, válaszd a <b>Network</b> (Hálózat) fület, és pipáld be a <b>Preserve log</b> (Napló megőrzése) négyzetet.</li>
    <li>Ebben a lapban nyisd meg a CareLink belépést: <a class="btn sm" href="<?= h($clAuthUrl) ?>" target="_blank" rel="noopener">CareLink belépés megnyitása</a><br>
      <span class="muted small">Ha új lapon nyílt meg, ott is nyomd meg az F12-t és pipáld be a Preserve logot, majd frissítsd az oldalt.</span></li>
    <li>Lépj be a <b>gondozói fiókkal</b> (e-mail, jelszó, „nem vagyok robot”).</li>
    <li>Belépés után az oldal üres marad vagy hibát ír. Ez így rendben van. A Network fül szűrőjébe írd be: <code>code=</code>. Kattints a megjelenő sorra (állapot: <b>302</b>), majd a <b>Headers</b> részben a <b>location</b> sor értékére: <code>com.medtronic.carepartner:/sso?code=…</code>. Jobb klikk, <b>Copy value</b>.
      <br><span class="muted small">Firefoxban a cím néha közvetlenül a címsorban is megjelenik, onnan is kimásolhatod.</span></li>
    <li>Illeszd be ide, és nyomd meg a <b>Kapcsolódás</b> gombot. A kód csak pár percig érvényes, ezért ne várj vele.</li>
  </ol>
  <form method="post" class="stack">
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <input type="hidden" name="action" value="cl_connect">
    <textarea name="cl_code" rows="3" required placeholder="com.medtronic.carepartner:/sso?code=…"></textarea>
    <button type="submit">Kapcsolódás</button>
  </form>
  <?php endif; ?>
</section>

<section class="card">
  <h2>Kapcsolat a telefonnal</h2>
  <p>A lépésenkénti útmutató a <a href="setup.php?step=2">Telefon beállítása</a> oldalon van. Ide csak a két beírandó érték került:</p>
  <div class="kv">
    <span>Cím (URL)</span><?= copy_chip($ingestUrl) ?>
    <span>X-Token fejléc</span><?= copy_chip($token) ?>
  </div>
  <form method="post" onsubmit="return confirm('Biztos? A régi kulccsal ezután nem lehet adatot küldeni.')">
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <input type="hidden" name="action" value="regen_token">
    <button type="submit" class="ghost">Új kulcs generálása</button>
  </form>
</section>

<section class="card">
  <h2>Kézi import</h2>
  <p class="muted">Soronként: <code>típus;dátum;érték</code>. A típus lehet <code>glucose</code>, <code>insulin</code> vagy <code>carbs</code>. Példa:</p>
  <pre>insulin;2026-10-07T08:05:00+02:00;4,5
carbs;2026-10-07T08:05:00+02:00;45
glucose;2026-10-07T08:00:00+02:00;6,2</pre>
  <form method="post" enctype="multipart/form-data" class="stack">
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <input type="hidden" name="action" value="import">
    <textarea name="lines" rows="5" placeholder="Illeszd be a sorokat…"></textarea>
    <label>vagy fájl (.txt / .csv / .json) <input type="file" name="file" accept=".txt,.csv,.json"></label>
    <button type="submit">Import</button>
  </form>
  <p class="muted">Régebbi adatokat a teljes Apple Health exportból lehet betölteni (Egészség app → profilkép → <i>Összes egészségügyi adat exportálása</i>). A kicsomagolt <code>export.xml</code>-t parancssorból töltsd be:</p>
  <?php if (is_file('/.dockerenv')): ?>
  <pre>docker cp export.xml cukornaplo:/tmp/export.xml
docker exec -u www-data cukornaplo php import_health_export.php /tmp/export.xml 2026-01-01</pre>
  <?php else: ?>
  <pre>C:\wamp64\bin\php\php<?= h(PHP_VERSION) ?>\php.exe <?= h(__DIR__ . DIRECTORY_SEPARATOR) ?>import_health_export.php C:\útvonal\export.xml 2026-01-01</pre>
  <?php endif; ?>
</section>
<?php
page_footer();
