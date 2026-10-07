<?php
// Közös függvények: adatbázis, beállítások, bejelentkezés, adatfeldolgozás.
// PHP 7.4 kompatibilis (a WAMP alapértelmezett Apache PHP-ja 7.4.12), Dockerben PHP 8.3 fut.

declare(strict_types=1);

date_default_timezone_set(getenv('APP_TZ') ?: 'Europe/Budapest');

// Dockerben DATA_DIR=/data (a webes gyökéren kívül), WAMP alatt a ./data mappa.
define('DATA_DIR', rtrim(getenv('DATA_DIR') ?: __DIR__ . '/data', '/\\'));
define('DB_FILE', DATA_DIR . '/diabetes.sqlite');
define('SETTINGS_FILE', DATA_DIR . '/settings.json');
const MGDL_PER_MMOL = 18.0182;

// Bejelentkezés: ennyi hibás próbálkozás után ennyi másodpercre letilt (IP-címenként).
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW = 900;

if (PHP_SAPI !== 'cli' && !headers_sent()) {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
}

// Céltartomány (mmol/L), a nemzetközi CGM konszenzus szerint.
const RANGE_VERY_LOW = 3.0;
const RANGE_LOW = 3.9;
const RANGE_HIGH = 10.0;
const RANGE_VERY_HIGH = 13.9;

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        if (!is_dir(DATA_DIR)) {
            mkdir(DATA_DIR, 0770, true);
        }
        $pdo = new PDO('sqlite:' . DB_FILE);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY,
                type TEXT NOT NULL CHECK (type IN ('glucose', 'insulin', 'carbs')),
                ts INTEGER NOT NULL,          -- unix idő (UTC másodperc)
                value REAL NOT NULL,          -- glükóz: mmol/L, inzulin: E, CH: g
                subtype TEXT,                 -- inzulin: bolus / basal (ha ismert)
                source TEXT,
                created_at INTEGER NOT NULL,
                UNIQUE (type, ts, value)
            )"
        );
        $pdo->exec('CREATE INDEX IF NOT EXISTS entries_type_ts ON entries (type, ts)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, ts INTEGER NOT NULL)');
    }
    return $pdo;
}

// ---------------------------------------------------------------- beállítások

function settings(): array
{
    if (!is_file(SETTINGS_FILE)) {
        return [];
    }
    $data = json_decode((string) file_get_contents(SETTINGS_FILE), true);
    return is_array($data) ? $data : [];
}

function setting(string $key, $default = null)
{
    $s = settings();
    return $s[$key] ?? $default;
}

function save_settings(array $changes): void
{
    if (!is_dir(DATA_DIR)) {
        mkdir(DATA_DIR, 0770, true);
    }
    $s = array_merge(settings(), $changes);
    file_put_contents(SETTINGS_FILE, json_encode($s, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function new_token(): string
{
    return bin2hex(random_bytes(24));
}

// ------------------------------------------------------------ munkamenet, auth

function start_session(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_name('medtronic_sess');
        session_set_cookie_params([
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => is_https(),
            'path' => app_path() . '/',
        ]);
        session_start();
    }
}

/**
 * Megbízhatunk-e a proxy által küldött X-Forwarded-* fejlécekben?
 * Igen, ha TRUST_PROXY=1 (Docker + Caddy / más reverse proxy), vagy ha a kérés
 * a gépről jön (WAMP mögötti helyi proxy). Közvetlenül elért szervernél nem,
 * mert akkor bárki hamisíthatná őket.
 */
function trust_proxy(): bool
{
    $remote = $_SERVER['REMOTE_ADDR'] ?? '';
    return getenv('TRUST_PROXY') === '1' || in_array($remote, ['127.0.0.1', '::1'], true);
}

function is_https(): bool
{
    if (strpos((string) getenv('PUBLIC_URL'), 'https://') === 0) {
        return true;
    }
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    return trust_proxy() && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function client_ip(): string
{
    $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($xff !== '' && trust_proxy()) {
        return trim(explode(',', $xff)[0]);
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

/** Hány másodperc múlva lehet újra próbálkozni (0 = most is lehet). */
function login_locked_for(): int
{
    $stmt = db()->prepare('SELECT COUNT(*), MIN(ts) FROM login_failures WHERE ip = ? AND ts > ?');
    $stmt->execute([client_ip(), time() - LOGIN_WINDOW]);
    [$count, $first] = $stmt->fetch(PDO::FETCH_NUM);
    return (int) $count >= LOGIN_MAX_FAILURES ? max(1, (int) $first + LOGIN_WINDOW - time()) : 0;
}

function login_failed(): void
{
    $pdo = db();
    $pdo->prepare('DELETE FROM login_failures WHERE ts < ?')->execute([time() - LOGIN_WINDOW]);
    $pdo->prepare('INSERT INTO login_failures (ip, ts) VALUES (?, ?)')->execute([client_ip(), time()]);
}

function login_succeeded(): void
{
    db()->prepare('DELETE FROM login_failures WHERE ip = ?')->execute([client_ip()]);
}

/**
 * Egyszeri beállító kód az első jelszó megadásához. Nyilvános szerveren e nélkül
 * bárki, aki elsőként megnyitja az oldalt, beállíthatná a jelszót.
 * A kód a szerver naplójába kerül (Dockerben: docker logs).
 */
function setup_code(): string
{
    $code = (string) setting('setup_code', '');
    if ($code === '') {
        $code = strtoupper(substr(bin2hex(random_bytes(4)), 0, 4) . '-' . substr(bin2hex(random_bytes(4)), 0, 4));
        save_settings(['setup_code' => $code]);
    }
    error_log("Cukornaplo beallito kod: $code");
    return $code;
}

/** Helyi gépről érkező kérés (WAMP-on a gépen ülő felhasználó): ott nem kell beállító kód. */
function is_local_request(): bool
{
    return in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)
        && empty($_SERVER['HTTP_X_FORWARDED_FOR']);
}

function require_login(): void
{
    start_session();
    if (!setting('password_hash')) {
        redirect('setup.php');
    }
    if (empty($_SESSION['auth'])) {
        redirect('login.php');
    }
}

function csrf_token(): string
{
    start_session();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return $_SESSION['csrf'];
}

function check_csrf(): void
{
    start_session();
    $sent = $_POST['csrf'] ?? '';
    if (!is_string($sent) || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $sent)) {
        http_response_code(400);
        exit('Érvénytelen űrlap. Töltsd újra az oldalt.');
    }
}

// ------------------------------------------------------------------- URL-ek

/** Az alkalmazás útvonala a webszerver gyökeréhez képest, pl. "/medtronic". */
function app_path(): string
{
    $docRoot = rtrim(str_replace('\\', '/', (string) realpath($_SERVER['DOCUMENT_ROOT'] ?? '')), '/');
    $dir = str_replace('\\', '/', __DIR__);
    if ($docRoot !== '' && stripos($dir, $docRoot) === 0) {
        return rtrim(substr($dir, strlen($docRoot)), '/');
    }
    return '';
}

function base_url(): string
{
    // Szerveren a nyilvános cím rögzíthető (pl. https://vc.baltazarka.com), így nem függ a proxy fejléceitől.
    $public = rtrim((string) getenv('PUBLIC_URL'), '/');
    if ($public !== '') {
        return $public;
    }
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    if (trust_proxy() && !empty($_SERVER['HTTP_X_FORWARDED_HOST'])) {
        $host = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_HOST'])[0]);
    }
    return (is_https() ? 'https' : 'http') . '://' . $host . app_path();
}

/** Helyi hálózati cím-e (localhost, privát IP, .local)? Ilyenkor a telefonnak ugyanazon a wifin kell lennie. */
function is_lan_url(string $url): bool
{
    $host = trim((string) parse_url($url, PHP_URL_HOST), '[]');
    if ($host === 'localhost' || $host === '::1' || substr($host, -6) === '.local') {
        return true;
    }
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return !filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    }
    return false;
}

/** A gép helyi hálózati IPv4 címe (192.168.x > 10.x > 172.16–31.x), ha van. */
function lan_ip(): ?string
{
    $ips = gethostbynamel((string) gethostname()) ?: [];
    $rank = function (string $ip): int {
        if (strpos($ip, '192.168.') === 0) {
            return 0;
        }
        if (strpos($ip, '10.') === 0) {
            return 1;
        }
        if (preg_match('/^172\.(1[6-9]|2\d|3[01])\./', $ip)) {
            return 2;
        }
        return 9;
    };
    $ips = array_filter($ips, function ($ip) use ($rank) {
        return $rank($ip) < 9;
    });
    usort($ips, function ($a, $b) use ($rank) {
        return $rank($a) <=> $rank($b);
    });
    return $ips[0] ?? null;
}

/** A telefon számára használható cím: localhost helyett a gép hálózati IP-je. */
function phone_base_url(): string
{
    $url = base_url();
    $parts = parse_url($url);
    $host = $parts['host'] ?? '';
    if (in_array($host, ['localhost', '127.0.0.1', '::1', '[::1]'], true) && ($ip = lan_ip())) {
        $port = isset($parts['port']) ? ':' . $parts['port'] : '';
        $url = $parts['scheme'] . '://' . $ip . $port . ($parts['path'] ?? '');
    }
    return $url;
}

function redirect(string $page): void
{
    header('Location: ' . app_path() . '/' . $page);
    exit;
}

function h($s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

// ------------------------------------------------------------ adatfeldolgozás

function normalize_type(string $t): ?string
{
    $t = strtr(trim($t), [
        'á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ö' => 'o', 'ő' => 'o', 'ú' => 'u', 'ü' => 'u', 'ű' => 'u',
        'Á' => 'a', 'É' => 'e', 'Í' => 'i', 'Ó' => 'o', 'Ö' => 'o', 'Ő' => 'o', 'Ú' => 'u', 'Ü' => 'u', 'Ű' => 'u',
    ]);
    $t = strtolower($t);
    $map = [
        'glucose' => 'glucose', 'bg' => 'glucose', 'sg' => 'glucose', 'blood glucose' => 'glucose',
        'blood_glucose' => 'glucose', 'vercukor' => 'glucose', 'vercukorszint' => 'glucose', 'glukoz' => 'glucose',
        'insulin' => 'insulin', 'inzulin' => 'insulin', 'insulin delivery' => 'insulin', 'insulin_delivery' => 'insulin',
        'carbs' => 'carbs', 'carb' => 'carbs', 'ch' => 'carbs', 'szenhidrat' => 'carbs',
        'carbohydrates' => 'carbs', 'dietary carbohydrates' => 'carbs', 'dietary_carbohydrates' => 'carbs',
    ];
    return $map[$t] ?? null;
}

/**
 * Dátum értelmezése: ISO 8601, Apple Health export, vagy a Parancsok app magyar alapformátuma
 * ("2026. 10. 07. 8:15", "2026. okt. 7. 8:15", "2026. október 7. 8:15:30").
 */
function parse_date(string $s): ?int
{
    // Az iOS néha keskeny / nem törhető szóközt tesz a dátumba.
    $s = trim(str_replace(["\u{00a0}", "\u{202f}", "\u{2009}"], ' ', $s));
    if ($s === '') {
        return null;
    }
    $months = [
        'jan' => 1, 'feb' => 2, 'mar' => 3, 'már' => 3, 'apr' => 4, 'ápr' => 4, 'maj' => 5, 'máj' => 5,
        'jun' => 6, 'jún' => 6, 'jul' => 7, 'júl' => 7, 'aug' => 8, 'sze' => 9, 'okt' => 10, 'nov' => 11, 'dec' => 12,
    ];
    if (preg_match('/^(\d{4})\.\s*([^\s.]+)\.?\s*(\d{1,2})\.?,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/u', $s, $m)) {
        $mon = $m[2];
        if (ctype_digit($mon)) {
            $month = (int) $mon;
        } else {
            $key = function_exists('mb_substr') ? mb_strtolower(mb_substr($mon, 0, 3)) : strtolower(substr($mon, 0, 3));
            $month = $months[$key] ?? 0;
        }
        if ($month >= 1 && $month <= 12) {
            $s = sprintf('%04d-%02d-%02d %02d:%02d:%02d', $m[1], $month, $m[3], $m[4], $m[5], $m[6] ?? 0);
        }
    }
    try {
        $ts = (new DateTime($s))->getTimestamp();
    } catch (Exception $e) {
        return null;
    }
    if ($ts < 946684800 || $ts > time() + 86400) { // 2000 előtt vagy a jövőben
        return null;
    }
    return $ts;
}

function parse_number(string $s): ?float
{
    $s = str_replace([' ', "\u{00a0}", ','], ['', '', '.'], $s);
    if (!preg_match('/-?\d+(?:\.\d+)?/', $s, $m)) {
        return null;
    }
    return (float) $m[0];
}

/**
 * Egy bejegyzés ellenőrzése és egységesítése.
 * Visszaad egy sort (array) vagy egy hibaüzenetet (string).
 */
function normalize_row(string $type, string $date, string $value, string $unit = '', string $source = '', string $subtype = '')
{
    $t = normalize_type($type);
    if ($t === null) {
        return "ismeretlen típus: \"$type\"";
    }
    $ts = parse_date($date);
    if ($ts === null) {
        return "nem értelmezhető dátum: \"$date\"";
    }
    $v = parse_number($value);
    if ($v === null) {
        return "nem értelmezhető érték: \"$value\"";
    }

    if ($t === 'glucose') {
        $isMgdl = stripos($unit . $value, 'mg') !== false || ($unit === '' && $v > 35);
        if ($isMgdl) {
            $v = $v / MGDL_PER_MMOL;
        }
        $v = round($v, 1);
        if ($v < 1 || $v > 35) {
            return "valószínűtlen glükózérték: $value $unit";
        }
    } elseif ($t === 'insulin') {
        $v = round($v, 2);
        if ($v <= 0 || $v > 100) {
            return "valószínűtlen inzulinadag: $value";
        }
    } else {
        $v = round($v, 1);
        if ($v <= 0 || $v > 500) {
            return "valószínűtlen CH-mennyiség: $value";
        }
    }

    $sub = null;
    if ($t === 'insulin' && $subtype !== '') {
        $st = strtolower($subtype);
        if (strpos($st, 'bas') !== false || $st === '1') {
            $sub = 'basal';
        } elseif (strpos($st, 'bol') !== false || $st === '2') {
            $sub = 'bolus';
        }
    }

    return [
        'type' => $t,
        'ts' => $ts,
        'value' => $v,
        'subtype' => $sub,
        'source' => trim($source) !== '' ? mb_substr_safe(trim($source), 80) : null,
    ];
}

function mb_substr_safe(string $s, int $len): string
{
    return function_exists('mb_substr') ? mb_substr($s, 0, $len) : substr($s, 0, $len);
}

/**
 * Soronként egy bejegyzés, pontosvesszővel (vagy tabbal / | jellel) tagolva:
 *   típus;dátum;érték;mértékegység;forrás;altípus
 * Az utolsó három mező elhagyható.
 */
function parse_text_lines(string $text): array
{
    $rows = [];
    $errors = [];
    foreach (preg_split('/\r\n|\r|\n/', $text) as $i => $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        $f = array_map('trim', preg_split('/[;\t|]/', $line));
        if (count($f) < 3) {
            $errors[] = 'sor ' . ($i + 1) . ': kevés mező (típus;dátum;érték kell)';
            continue;
        }
        $r = normalize_row($f[0], $f[1], $f[2], $f[3] ?? '', $f[4] ?? '', $f[5] ?? '');
        if (is_string($r)) {
            $errors[] = 'sor ' . ($i + 1) . ': ' . $r;
        } else {
            $rows[] = $r;
        }
    }
    return ['rows' => $rows, 'errors' => $errors];
}

/**
 * JSON bemenet. Elfogadott formák:
 *  - {"data": "<szöveges sorok>"}             (Parancsok app, JSON törzs)
 *  - {"entries": [{"type","date","value","unit","source","subtype"}]}
 *  - Health Auto Export app: {"data": {"metrics": [{"name","units","data": [{"date","qty"}]}]}}
 */
function parse_json_payload(array $json): array
{
    if (isset($json['data']) && is_string($json['data'])) {
        return parse_text_lines($json['data']);
    }
    $rows = [];
    $errors = [];
    $add = function ($r) use (&$rows, &$errors) {
        if (is_string($r)) {
            $errors[] = $r;
        } else {
            $rows[] = $r;
        }
    };

    if (isset($json['entries']) && is_array($json['entries'])) {
        foreach ($json['entries'] as $e) {
            if (!is_array($e)) {
                continue;
            }
            $add(normalize_row(
                (string) ($e['type'] ?? ''),
                (string) ($e['date'] ?? ''),
                (string) ($e['value'] ?? ''),
                (string) ($e['unit'] ?? ''),
                (string) ($e['source'] ?? ''),
                (string) ($e['subtype'] ?? '')
            ));
        }
    }

    $metrics = $json['data']['metrics'] ?? null;
    if (is_array($metrics)) {
        foreach ($metrics as $m) {
            $type = normalize_type((string) ($m['name'] ?? ''));
            if ($type === null || !is_array($m['data'] ?? null)) {
                continue;
            }
            foreach ($m['data'] as $d) {
                $val = $d['qty'] ?? ($d['Avg'] ?? null);
                $add(normalize_row(
                    $type,
                    (string) ($d['date'] ?? ''),
                    (string) $val,
                    (string) ($m['units'] ?? ''),
                    (string) ($d['source'] ?? 'Health Auto Export'),
                    (string) ($d['reason'] ?? '')
                ));
            }
        }
    }
    return ['rows' => $rows, 'errors' => $errors];
}

/** Mentés; a már meglévő (azonos típus + időpont + érték) sorokat kihagyja. */
function store_rows(array $rows): array
{
    $pdo = db();
    $stmt = $pdo->prepare(
        'INSERT OR IGNORE INTO entries (type, ts, value, subtype, source, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    $inserted = 0;
    $now = time();
    $pdo->beginTransaction();
    foreach ($rows as $r) {
        $stmt->execute([$r['type'], $r['ts'], $r['value'], $r['subtype'], $r['source'], $now]);
        $inserted += $stmt->rowCount();
    }
    $pdo->commit();
    return [$inserted, count($rows) - $inserted];
}

function record_ingest(string $via, int $inserted, int $duplicates, array $errors, ?int $received = null, ?string $firstLine = null): void
{
    save_settings(['last_ingest' => [
        'at' => time(),
        'via' => $via,
        'received' => $received,
        'first_line' => $firstLine,
        'inserted' => $inserted,
        'duplicates' => $duplicates,
        'errors' => array_slice($errors, 0, 5),
    ]]);
}

// ------------------------------------------------------------- statisztika

function glucose_stats(array $values): array
{
    $n = count($values);
    if ($n === 0) {
        return ['n' => 0];
    }
    $sum = array_sum($values);
    $avg = $sum / $n;
    $var = 0.0;
    foreach ($values as $v) {
        $var += ($v - $avg) ** 2;
    }
    $sd = $n > 1 ? sqrt($var / ($n - 1)) : 0.0;
    $bands = ['veryLow' => 0, 'low' => 0, 'inRange' => 0, 'high' => 0, 'veryHigh' => 0];
    foreach ($values as $v) {
        if ($v < RANGE_VERY_LOW) {
            $bands['veryLow']++;
        } elseif ($v < RANGE_LOW) {
            $bands['low']++;
        } elseif ($v <= RANGE_HIGH) {
            $bands['inRange']++;
        } elseif ($v <= RANGE_VERY_HIGH) {
            $bands['high']++;
        } else {
            $bands['veryHigh']++;
        }
    }
    $pct = [];
    foreach ($bands as $k => $c) {
        $pct[$k] = 100 * $c / $n;
    }
    return [
        'n' => $n,
        'avg' => $avg,
        'sd' => $sd,
        'cv' => $avg > 0 ? 100 * $sd / $avg : 0,
        'min' => min($values),
        'max' => max($values),
        // GMI (glükóz menedzsment index), Bergenstal 2018: 3,31 + 0,02392 × átlag mg/dL
        'gmi' => 3.31 + 0.02392 * $avg * MGDL_PER_MMOL,
        'pct' => $pct,
    ];
}

function fmt($v, int $dec = 1): string
{
    return number_format((float) $v, $dec, ',', ' ');
}
