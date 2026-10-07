<?php
// Beállító varázsló: jelszó → kapcsolat próba → InPen → Egészség → küldés módja → beállítás → ellenőrzés.

declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/layout.php';

start_session();

$hasPassword = (bool) setting('password_hash');
$step = (int) ($_GET['step'] ?? 1);
$method = ($_GET['m'] ?? '') === 'sc' ? 'sc' : (($_GET['m'] ?? '') === 'hae' ? 'hae' : '');

if (!$hasPassword) {
    $step = 1;
} elseif (empty($_SESSION['auth'])) {
    redirect('login.php');
} elseif ($step < 2 || $step > 6) {
    $step = 2;
}
if ($step === 5 && $method === '') {
    $step = 4;
}

// 1. lépés: jelszó mentése. Távolról (szerveren) csak a naplóba írt beállító kóddal.
$error = '';
$needCode = $step === 1 && !is_local_request();
$code = $needCode ? setup_code() : '';
if ($step === 1 && $_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    $p1 = (string) ($_POST['password'] ?? '');
    $p2 = (string) ($_POST['password2'] ?? '');
    $sentCode = strtoupper(trim((string) ($_POST['setup_code'] ?? '')));
    if ($needCode && login_locked_for() > 0) {
        $error = 'Túl sok hibás próbálkozás. Próbáld újra később.';
    } elseif ($needCode && !hash_equals($code, $sentCode)) {
        login_failed();
        $error = 'Hibás beállító kód.';
    } elseif (strlen($p1) < 8) {
        $error = 'A jelszó legyen legalább 8 karakter.';
    } elseif ($p1 !== $p2) {
        $error = 'A két jelszó nem egyezik.';
    } else {
        save_settings([
            'password_hash' => password_hash($p1, PASSWORD_DEFAULT),
            'api_token' => new_token(),
            'setup_code' => null,
        ]);
        session_regenerate_id(true);
        $_SESSION['auth'] = true;
        redirect('setup.php?step=2');
    }
}

$ingestUrl = phone_base_url() . '/api/ingest.php';
$lan = is_lan_url($ingestUrl);
$token = (string) setting('api_token', '');
$mq = $method ? '&m=' . $method : '';

$steps = [1 => 'Jelszó', 2 => 'Kapcsolat', 3 => 'InPen', 4 => 'Küldés módja', 5 => 'Beállítás', 6 => 'Próba'];

function step_url(int $n, string $mq = ''): string
{
    return 'setup.php?step=' . $n . $mq;
}

/** Egy Parancsok-változó „buborék” megjelenítése. */
function pill(string $s): string
{
    return '<span class="pill">' . h($s) . '</span>';
}

page_header('Telefon beállítása', 'setup');
?>
<ol class="stepper" aria-label="Lépések">
  <?php foreach ($steps as $n => $label): ?>
  <li class="<?= $n === $step ? 'current' : ($n < $step ? 'done' : '') ?>"><span><?= $n ?></span><?= h($label) ?></li>
  <?php endforeach; ?>
</ol>

<?php if ($step === 1): ?>
<section class="card wizard">
  <h1>Jelszó</h1>
  <p>Ezzel a jelszóval tudod majd megnyitni a naplódat. Az adatok csak ezen a szerveren tárolódnak.</p>
  <?php if ($error): ?><p class="alert"><?= h($error) ?></p><?php endif; ?>
  <form method="post" class="stack narrow-form">
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <?php if ($needCode): ?>
    <label>Beállító kód
      <input type="text" name="setup_code" required autocomplete="off" autocapitalize="characters" placeholder="XXXX-XXXX">
    </label>
    <p class="muted small">A kódot a szerver naplójában találod. Dockerben: <code>docker logs cukornaplo 2&gt;&amp;1 | grep kod</code>. Ez védi meg, hogy más ne állíthasson be jelszót helyetted.</p>
    <?php endif; ?>
    <label>Jelszó (legalább 8 karakter) <input type="password" name="password" autocomplete="new-password" required minlength="8"></label>
    <label>Jelszó még egyszer <input type="password" name="password2" autocomplete="new-password" required minlength="8"></label>
    <button type="submit">Mentés és tovább</button>
  </form>
</section>

<?php elseif ($step === 2): ?>
<section class="card wizard">
  <h1>Eléri-e a telefon a szervert?</h1>
  <ol class="steps">
    <?php if ($lan): ?>
    <li>Csatlakoztasd az iPhone-t <b>ugyanarra a wifire</b>, amin ez a gép van.</li>
    <?php else: ?>
    <li>Az iPhone bármilyen hálózatról (wifi, mobilnet) elérheti, nem kell ugyanazon a wifin lennie.</li>
    <?php endif; ?>
    <li>Nyisd meg iPhone-on a <b>Safari</b>t, és írd be ezt a címet:
      <div class="value"><?= copy_chip($ingestUrl) ?></div>
    </li>
    <li>Nézd meg, mit ír ki:
      <table class="table outcomes">
        <tr><td class="ok">✓</td><td><code>{"ok":false,"error":"Csak POST kérést fogadok."}</code></td><td><b>Rendben</b>, mehetsz tovább.</td></tr>
        <?php if ($lan): ?>
        <tr><td class="bad">✕</td><td><b>Forbidden</b></td><td>A gép webszervere nem engedi be a telefont. Lásd lent: <i>Forbidden javítása</i>.</td></tr>
        <tr><td class="bad">✕</td><td>Sokáig tölt, majd hiba</td><td>A telefon nem látja a gépet: nem ugyanaz a wifi, vagy a tűzfal tiltja. Próbáld a gép <b>Mobil hotspot</b>jával (Windows Beállítások → Hálózat és internet → Mobil hotspot), és nyisd meg újra ezt az oldalt a gépen. A cím ilyenkor megváltozik.</td></tr>
        <?php else: ?>
        <tr><td class="bad">✕</td><td>„Nem biztonságos kapcsolat” / tanúsítványhiba</td><td>A HTTPS még nincs kész. Ellenőrizd a reverse proxy beállítását: a domain HTTPS-sel mutasson a Pi 5478-as portjára.</td></tr>
        <tr><td class="bad">✕</td><td>A szerver nem található</td><td>A domain DNS-rekordja (A rekord) még nem a szervered nyilvános IP-címére mutat, vagy még nem frissült.</td></tr>
        <?php endif; ?>
      </table>
    </li>
  </ol>
  <?php if ($lan): ?>
  <details class="fix">
    <summary>Forbidden javítása</summary>
    <p>A <code><?= h(str_replace('/', '\\', __DIR__)) ?>\.htaccess</code> fájl végére írd be ezt, majd mentsd el:</p>
    <pre>&lt;RequireAny&gt;
  Require local
  Require ip 192.168 10 172.16.0.0/12
&lt;/RequireAny&gt;</pre>
    <p class="muted">Ez csak a helyi hálózatról enged be, az internet felől nem. A belső fájlok (adatbázis, beállítások) továbbra is tiltva maradnak.</p>
  </details>
  <?php endif; ?>
  <div class="nav-row"><span></span><a class="btn" href="<?= step_url(3) ?>">Működik, tovább →</a></div>
</section>

<?php elseif ($step === 3): ?>
<section class="card wizard">
  <h1>InPen → Egészség app</h1>
  <p>Az InPen app beírja az adagokat és a szénhidrátot az iPhone Egészség appjába, onnan küldjük tovább.</p>
  <ol class="steps">
    <li><b>InPen app</b> → <b>Settings</b> (Beállítások) → <b>Connections</b> → <b>Apple Health</b> → <b>Turn All Categories On</b>.</li>
    <li>Ellenőrzés: <b>Egészség app</b> → <b>Böngészés</b> → keresd meg az <b>Inzulinadagolás</b>t. Ott kell látnod a mai InPen-adagokat.</li>
    <li>Ugyanígy nézd meg a <b>Szénhidrátok</b>at és a <b>Vércukor</b>t is.</li>
  </ol>
  <p class="muted">Ha a Vércukor üres, akkor a Guardian app nem ír az Egészség appba. Ilyenkor a Guardian app beállításaiban keresd az Apple Health / Egészség megosztást. Ha ott sincs, a napló csak inzulint és CH-t fog mutatni, a glükózt a CareLinkben látod.</p>
  <div class="nav-row"><a class="btn ghost" href="<?= step_url(2) ?>">← Vissza</a><a class="btn" href="<?= step_url(4) ?>">Tovább →</a></div>
</section>

<?php elseif ($step === 4): ?>
<section class="card wizard">
  <h1>Hogyan küldje a telefon az adatokat?</h1>
  <div class="choices">
    <a class="choice" href="<?= step_url(5, '&m=hae') ?>">
      <span class="tag">Ajánlott</span>
      <b>Health Auto Export app</b>
      <span>Csak be kell állítani, kb. 5 perc. Fizetős (Premium: 6,99 $/év vagy egyszer 24,99 $), 7 nap ingyenes próbával.</span>
    </a>
    <a class="choice" href="<?= step_url(5, '&m=sc') ?>">
      <b>Parancsok app (ingyenes)</b>
      <span>A telefonon kézzel kell összerakni egy parancsot, kb. 15 perc.</span>
    </a>
  </div>
  <div class="nav-row"><a class="btn ghost" href="<?= step_url(3) ?>">← Vissza</a><span></span></div>
</section>

<?php elseif ($step === 5 && $method === 'hae'): ?>
<section class="card wizard">
  <h1>Health Auto Export beállítása</h1>
  <ol class="steps">
    <li>Telepítsd az App Store-ból: <b>Health Auto Export – JSON+CSV</b>. Nyisd meg, és amikor kéri, engedélyezd az Egészség-hozzáférést (legalább: Vércukor, Inzulinadagolás, Szénhidrátok).</li>
    <li>Alul az <b>Automations</b> fül → <b>+</b> (új automatizmus) → típus: <b>REST API</b>.</li>
    <li>Töltsd ki így:
      <table class="table form-map">
        <tr><th>Mező</th><th>Érték</th></tr>
        <tr><td>Name</td><td>Cukornapló</td></tr>
        <tr><td>URL</td><td><?= copy_chip($ingestUrl) ?></td></tr>
        <tr><td>Headers → Add Header</td><td>Key: <?= copy_chip('X-Token') ?><br>Value: <?= copy_chip($token) ?></td></tr>
        <tr><td>Data Type</td><td>Health Metrics</td></tr>
        <tr><td>Select Health Metrics</td><td>Csak ez a három: <b>Blood Glucose</b>, <b>Insulin Delivery</b>, <b>Carbohydrates</b></td></tr>
        <tr><td>Export Format</td><td><b>JSON</b></td></tr>
        <tr><td>Date Range</td><td>az utolsó 3 nap (Last 3 Days, vagy a hozzá legközelebbi)</td></tr>
        <tr><td>Aggregate Data / Time Grouping</td><td><b>Aggregate Data kikapcsolva.</b> Ha nem lehet kikapcsolni, a Time Grouping legyen a legkisebb (Seconds / Minutes). Különben óránkénti összegeket küld.</td></tr>
        <tr><td>Sync Cadence</td><td>pl. 15 perc vagy 1 óra</td></tr>
      </table>
    </li>
    <li>Mentsd el, és kapcsold be az automatizmust (Enabled).</li>
  </ol>
  <p class="muted">Ha egy mező neve kicsit más az appban, a hozzá legközelebbit válaszd. A lényeg: URL, X-Token fejléc, JSON formátum, a három adattípus, és ne legyen összevonás.</p>
  <div class="nav-row"><a class="btn ghost" href="<?= step_url(4) ?>">← Vissza</a><a class="btn" href="<?= step_url(6, $mq) ?>">Kész, jöhet a próba →</a></div>
</section>

<?php elseif ($step === 5 && $method === 'sc'): ?>
<section class="card wizard">
  <h1>Parancs összerakása (Parancsok app)</h1>
  <p>Először csak a <b>vércukor</b>-parancsot rakd össze és próbáld ki. Ha működik, lemásoljuk az inzulinhoz és a szénhidráthoz. A műveleteket alul a <b>Keresés a műveletek között</b> mezővel találod meg.</p>

  <h2>A) Új parancs</h2>
  <p>Parancsok app → <b>Parancsok</b> fül → <b>+</b> → nevezd el: <?= copy_chip('Vércukor küldés') ?></p>

  <h2>B) Műveletek, ebben a sorrendben</h2>
  <div class="actions">
    <div class="action">
      <div class="action-title"><span>1</span>Egészségügyi minták keresése</div>
      <table class="table form-map">
        <tr><td>Típus</td><td><b>Vércukor</b></td></tr>
        <tr><td>Dátum</td><td>Kezdő dátum → <b>az utolsó</b> → <b>3 nap</b></td></tr>
        <tr><td>Mértékegység</td><td><b>mmol/L</b></td></tr>
        <tr><td>Csoportosítás</td><td><b>Nincs</b></td></tr>
        <tr><td>Rendezés</td><td>Kezdő dátum, legrégebbi elöl</td></tr>
        <tr><td>Korlát</td><td><b>kikapcsolva</b></td></tr>
      </table>
    </div>
    <div class="action">
      <div class="action-title"><span>2</span>Egészségügyi minta részleteinek lekérése</div>
      <table class="table form-map">
        <tr><td>Részlet</td><td><b>Kezdő dátum</b></td></tr>
        <tr><td>Bemenet</td><td><?= pill('Egészségügyi minták') ?> (magától ez lesz)</td></tr>
      </table>
    </div>
    <div class="action">
      <div class="action-title"><span>3</span>Szöveg egyesítése</div>
      <table class="table form-map">
        <tr><td>Bemenet</td><td><?= pill('Kezdő dátum') ?> (magától ez lesz)</td></tr>
        <tr><td>Elválasztó</td><td><b>Új sor</b></td></tr>
      </table>
    </div>
    <div class="action">
      <div class="action-title"><span>4</span>Egészségügyi minta részleteinek lekérése <small>(még egyszer)</small></div>
      <table class="table form-map">
        <tr><td>Részlet</td><td><b>Érték</b></td></tr>
        <tr><td>Bemenet</td><td>Magától az <?= pill('Egyesített szöveg') ?> kerül ide, ez <b>rossz</b>. Koppints rá → válaszd az <?= pill('Egészségügyi minták') ?>-at.</td></tr>
      </table>
    </div>
    <div class="action">
      <div class="action-title"><span>5</span>Szöveg egyesítése <small>(még egyszer)</small></div>
      <table class="table form-map">
        <tr><td>Bemenet</td><td><?= pill('Érték') ?> (magától ez lesz)</td></tr>
        <tr><td>Elválasztó</td><td><b>Új sor</b></td></tr>
      </table>
    </div>
    <div class="action">
      <div class="action-title"><span>6</span>URL tartalmának lekérése</div>
      <p>Ha az URL helyére magától bekerül egy kék buborék, koppints rá → <b>Törlés</b>. A helyére írd be:</p>
      <div class="value"><?= copy_chip($ingestUrl) ?></div>
      <p>Utána a művelet jobb oldalán a <b>›</b> nyílra koppintva:</p>
      <table class="table form-map">
        <tr><td>Metódus</td><td><b>POST</b></td></tr>
        <tr><td>Fejlécek → Új fejléc</td><td>Kulcs: <?= copy_chip('X-Token') ?><br>Szöveg: <?= copy_chip($token) ?></td></tr>
        <tr><td>Kérés törzse</td><td><b>Űrlap</b>, és három <b>Szöveg</b> típusú mező (Új mező → Szöveg):</td></tr>
        <tr><td>1. mező</td><td>Kulcs: <?= copy_chip('type') ?><br>Szöveg: <?= copy_chip('glucose') ?> (begépelve)</td></tr>
        <tr><td>2. mező</td><td>Kulcs: <?= copy_chip('dates') ?><br>Szöveg: a <b>3. lépés</b> eredménye. Koppints a mezőbe → <b>Változó kiválasztása</b> → koppints a 3. lépés alatti <?= pill('Egyesített szöveg') ?> buborékra.</td></tr>
        <tr><td>3. mező</td><td>Kulcs: <?= copy_chip('values') ?><br>Szöveg: ugyanígy, az <b>5. lépés</b> alatti <?= pill('Egyesített szöveg') ?>.</td></tr>
      </table>
      <p class="muted">Az URL nem fejléc. Fejlécből csak egy van: az X-Token.</p>
    </div>
    <div class="action">
      <div class="action-title"><span>7</span>Eredmény megjelenítése</div>
      <p>Csak a próbához kell. Futtasd a parancsot a ▶ gombbal. Siker esetén ilyesmit látsz: <code>{"ok":true,"inserted":288,…,"first_line":"glucose;…;6,2"}</code></p>
    </div>
  </div>
  <p class="muted">Ismétlés nem kell, ezért gyors akkor is, ha több napnyi mérést küld. Ha a válasz azt írja, hogy a dátumok és az értékek száma nem egyezik, akkor a 4. lépés bemenete nem az Egészségügyi minták.</p>

  <h2>C) Inzulin és szénhidrát</h2>
  <p>Ha a vércukor-parancs működik: a Parancsok fülön tartsd lenyomva → <b>Duplikálás</b>, kétszer. A másolatokban csak ezt írd át:</p>
  <table class="table form-map">
    <tr><th></th><th>Inzulin</th><th>Szénhidrát</th></tr>
    <tr><td>Név</td><td>Inzulin küldés</td><td>CH küldés</td></tr>
    <tr><td>1. Típus</td><td><b>Inzulinadagolás</b></td><td><b>Szénhidrátok</b></td></tr>
    <tr><td>1. Mértékegység</td><td><b>NE</b> (IU)</td><td><b>g</b></td></tr>
    <tr><td>6. <code>type</code> mező</td><td><?= copy_chip('insulin') ?></td><td><?= copy_chip('carbs') ?></td></tr>
  </table>
  <p>A <b>7. Eredmény megjelenítése</b> műveletet a próba után mindhárom parancsból törölheted.</p>

  <h2>D) Egy parancs, ami mindhármat futtatja</h2>
  <p>Új parancs <?= copy_chip('Cukornapló küldés') ?> néven, benne háromszor a <b>Parancs futtatása</b> művelet: Vércukor küldés, Inzulin küldés, CH küldés.</p>

  <div class="nav-row"><a class="btn ghost" href="<?= step_url(4) ?>">← Vissza</a><a class="btn" href="<?= step_url(6, $mq) ?>">Kész, jöhet a próba →</a></div>
</section>

<?php elseif ($step === 6): ?>
<section class="card wizard">
  <h1>Próba és automatikus küldés</h1>
  <ol class="steps">
    <li><?= $method === 'hae'
        ? 'A Health Auto Exportban nyisd meg a Cukornapló automatizmust, és nyomd meg a <b>Manual Export</b> (kézi küldés) gombot.'
        : 'A Parancsok appban futtasd a <b>Cukornapló küldés</b> parancsot.' ?></li>
    <li>Ez az oldal magától frissül, amint megérkezik az adat:</li>
  </ol>
  <div class="live" id="live" aria-live="polite">
    <div class="live-status" id="live-status">Várakozás az adatra…</div>
    <div class="live-counts" id="live-counts"></div>
  </div>

  <?php if ($method === 'sc'): ?>
  <h2>Automatikus futtatás</h2>
  <ol class="steps">
    <li>Parancsok app → <b>Automatizálás</b> fül → <b>+</b> → <b>App</b>.</li>
    <li>App: <b>InPen</b>, és jelöld be: <b>Bezárva</b> (a <i>Megnyitva</i> ne legyen bejelölve).</li>
    <li>Válaszd: <b>Azonnali futtatás</b> (ne kérjen megerősítést).</li>
    <li>Következő → válaszd a <b>Cukornapló küldés</b> parancsot.</li>
  </ol>
  <p class="muted">Így minden InPen-könyvelés után, amikor bezárod az appot, magától küld.<?= $lan ? ' Ha nem vagy a gép wifijén, a küldés nem sikerül, de a következő alkalommal pótolja (mindig az utolsó 3 napot küldi).' : '' ?></p>
  <?php else: ?>
  <h2>Automatikus küldés</h2>
  <p>A Health Auto Export a beállított gyakorisággal (Sync Cadence) magától küld a háttérben. Ehhez az iPhone-on legyen engedélyezve a <b>Háttérben frissítés</b> az appnak (Beállítások → Általános → Háttérben frissítés). Zárolt telefonnál az iOS nem engedi olvasni az Egészség-adatokat, ezért a küldés sokszor csak a telefon feloldása után történik meg.</p>
  <?php endif; ?>

  <div class="nav-row"><a class="btn ghost" href="<?= step_url(5, $mq) ?>">← Vissza</a><a class="btn" href="./">Kész, irány a napló →</a></div>
</section>
<script>
(function () {
  var statusEl = document.getElementById('live-status');
  var countsEl = document.getElementById('live-counts');
  var box = document.getElementById('live');
  var startTs = Math.floor(Date.now() / 1000) - 5;
  function render(d) {
    var c = d.counts;
    countsEl.innerHTML =
      '<span>Glükóz: <b>' + c.glucose + '</b></span>' +
      '<span>Inzulin: <b>' + c.insulin + '</b></span>' +
      '<span>Szénhidrát: <b>' + c.carbs + '</b></span>';
    if (d.last && d.last.atTs >= startTs) {
      box.className = 'live ' + (d.last.errors.length && !d.last.inserted && !d.last.duplicates ? 'warn' : 'ok');
      statusEl.innerHTML = '✓ Adat érkezett ' + d.last.at + '-kor: <b>' + d.last.inserted + '</b> új, ' +
        d.last.duplicates + ' már megvolt' +
        (d.last.errors.length ? '<br><span class="muted">Hibás sorok: ' + d.last.errors.map(function (e) {
          return e.replace(/[<>&]/g, '');
        }).join(' · ') + '</span>' : '');
    }
  }
  function poll() {
    fetch('api/status.php', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok) render(d); })
      .catch(function () {})
      .then(function () { setTimeout(poll, 3000); });
  }
  poll();
})();
</script>
<?php endif; ?>
<?php
page_footer();
