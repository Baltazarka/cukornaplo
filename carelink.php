<?php
// CareLink (Medtronic felhő) kapcsolat: a Guardian szenzor glükózértékeinek lekérése
// gondozói (care partner) fiókkal. Nem hivatalos, visszafejtett API, ugyanazt a módszert
// követi, mint az xDrip+ CareLink Follower és a carelink-python-client (2026, Auth0 belépés).

declare(strict_types=1);

const CL_DISCOVERY_URL = 'https://clcloud.minimed.eu/connect/carepartner/v13/discover/android/3.6';
const CL_REGION = 'EU';
const CL_USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 10; Nexus 5X Build/QQ3A.200805.001)';
const CL_RAW_FILE = 'carelink_last.json';

function cl_state(): array
{
    $s = setting('carelink');
    return is_array($s) ? $s : [];
}

function cl_save(array $changes): void
{
    save_settings(['carelink' => array_merge(cl_state(), $changes)]);
}

function cl_is_connected(): bool
{
    $s = cl_state();
    return !empty($s['refresh_token']);
}

/** HTTP kérés curl-lel. Visszaad: [státuszkód, törzs]. */
function cl_http(string $method, string $url, array $headers = [], ?string $body = null): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => array_merge(['User-Agent: ' . CL_USER_AGENT], $headers),
        CURLOPT_TIMEOUT => 25,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    // WAMP (Windows) PHP-ben gyakran nincs beállítva CA-lista: ilyenkor a Windows tanúsítványtárát használjuk.
    if (PHP_OS_FAMILY === 'Windows' && !ini_get('curl.cainfo') && defined('CURLSSLOPT_NATIVE_CA')) {
        curl_setopt($ch, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA);
    }
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false) {
        throw new RuntimeException('Hálózati hiba: ' . $err);
    }
    return [$code, (string) $resp];
}

function cl_json(string $body): ?array
{
    $j = json_decode($body, true);
    return is_array($j) ? $j : null;
}

/** A CareLink végpontjai és az Auth0 beállítások (a Medtronic nyilvános konfigurációjából, 1 napig tárolva). */
function cl_config(bool $force = false): array
{
    $s = cl_state();
    if (!$force && !empty($s['config']) && ($s['config_at'] ?? 0) > time() - 86400) {
        return $s['config'];
    }
    [$code, $body] = cl_http('GET', CL_DISCOVERY_URL);
    $disc = cl_json($body);
    if ($code !== 200 || !$disc) {
        throw new RuntimeException("A CareLink konfiguráció nem érhető el (HTTP $code).");
    }
    $region = null;
    foreach ($disc['CP'] ?? [] as $c) {
        if (strtoupper($c['region'] ?? '') === CL_REGION) {
            $region = $c;
        }
    }
    if (!$region) {
        throw new RuntimeException('Az EU régió nem található a CareLink konfigurációban.');
    }
    $ssoKey = $region['UseSSOConfiguration'] ?? 'Auth0SSOConfiguration';
    [$code, $body] = cl_http('GET', (string) $region[$ssoKey]);
    $sso = cl_json($body);
    if ($code !== 200 || !$sso || empty($sso['client'])) {
        throw new RuntimeException("A CareLink belépési beállítások nem érhetők el (HTTP $code).");
    }
    $srv = $sso['server'];
    $authBase = 'https://' . $srv['hostname'] . (($srv['port'] ?? 443) != 443 ? ':' . $srv['port'] : '') . rtrim('/' . ltrim((string) ($srv['prefix'] ?? ''), '/'), '/');
    $config = [
        'auth_base' => $authBase,
        'authorize_path' => $sso['system_endpoints']['authorization_endpoint_path'],
        'token_path' => $sso['system_endpoints']['token_endpoint_path'],
        'client_id' => $sso['client']['client_id'],
        'scope' => $sso['client']['scope'],
        'redirect_uri' => $sso['client']['redirect_uri'],
        'audience' => $sso['client']['audience'] ?? '',
        'carelink_host' => parse_url((string) $region['baseUrlCareLink'], PHP_URL_HOST),
        'cumulus_base' => rtrim((string) $region['baseUrlCumulus'], '/'),
        'cloud_host' => parse_url((string) $region['baseUrlCumulus'], PHP_URL_HOST),
    ];
    cl_save(['config' => $config, 'config_at' => time()]);
    return $config;
}

/** A böngészős belépés címe (ugyanaz, amit a CareLink Connect app nyit meg). */
function cl_authorize_url(): string
{
    $c = cl_config();
    return $c['auth_base'] . $c['authorize_path'] . '?' . http_build_query([
        'client_id' => $c['client_id'],
        'response_type' => 'code',
        'scope' => $c['scope'],
        'redirect_uri' => $c['redirect_uri'],
        'audience' => $c['audience'],
    ], '', '&', PHP_QUERY_RFC3986);
}

/** A beillesztett szövegből (teljes átirányítási cím vagy csak a kód) kiveszi a kódot. */
function cl_extract_code(string $input): ?string
{
    $input = trim($input);
    if (preg_match('/[?&#]code=([^&#\s"\']+)/', $input, $m)) {
        return urldecode($m[1]);
    }
    if (preg_match('/^[A-Za-z0-9_\-.~]{10,}$/', $input)) {
        return $input;
    }
    return null;
}

function cl_store_tokens(array $tok): void
{
    $changes = [
        'access_token' => $tok['access_token'],
        'expires_at' => time() + (int) ($tok['expires_in'] ?? 3600),
    ];
    if (!empty($tok['refresh_token'])) {
        $changes['refresh_token'] = $tok['refresh_token'];
    }
    cl_save($changes);
}

/** Kód → hozzáférési és frissítő token, majd a fiók ellenőrzése. */
function cl_connect_with_code(string $input): array
{
    $code = cl_extract_code($input);
    if ($code === null) {
        throw new RuntimeException('Nem találtam kódot a beillesztett szövegben. A „com.medtronic.carepartner:/sso?code=…” kezdetű címet másold be.');
    }
    $c = cl_config();
    [$status, $body] = cl_http('POST', $c['auth_base'] . $c['token_path'],
        ['Content-Type: application/x-www-form-urlencoded'],
        http_build_query([
            'grant_type' => 'authorization_code',
            'client_id' => $c['client_id'],
            'code' => $code,
            'redirect_uri' => $c['redirect_uri'],
        ]));
    $tok = cl_json($body);
    if ($status !== 200 || empty($tok['access_token'])) {
        $msg = $tok['error_description'] ?? ($tok['error'] ?? "HTTP $status");
        throw new RuntimeException('A CareLink nem fogadta el a kódot (' . $msg . '). A kód csak pár percig érvényes és egyszer használható: lépj be újra, és rögtön másold be.');
    }
    cl_store_tokens($tok);
    cl_save(['session' => null, 'last_error' => null]);
    return cl_session(true);
}

function cl_refresh(): void
{
    $s = cl_state();
    if (empty($s['refresh_token'])) {
        throw new RuntimeException('Nincs CareLink kapcsolat. Lépj be újra.');
    }
    $c = cl_config();
    [$status, $body] = cl_http('POST', $c['auth_base'] . $c['token_path'],
        ['Content-Type: application/x-www-form-urlencoded'],
        http_build_query([
            'grant_type' => 'refresh_token',
            'client_id' => $c['client_id'],
            'refresh_token' => $s['refresh_token'],
        ]));
    $tok = cl_json($body);
    if ($status !== 200 || empty($tok['access_token'])) {
        if ($status === 403 || $status === 401 || ($tok['error'] ?? '') === 'invalid_grant') {
            cl_save(['refresh_token' => null, 'access_token' => null]);
            throw new RuntimeException('A CareLink belépés lejárt. Lépj be újra: Adatok és import → CareLink.');
        }
        throw new RuntimeException("A CareLink token frissítése nem sikerült (HTTP $status).");
    }
    cl_store_tokens($tok);
}

function cl_access_token(): string
{
    $s = cl_state();
    if (empty($s['access_token']) || ($s['expires_at'] ?? 0) < time() + 300) {
        cl_refresh();
        $s = cl_state();
    }
    return (string) $s['access_token'];
}

/** Hitelesített kérés; 401/403 esetén egyszer frissíti a tokent és újrapróbálja. */
function cl_api(string $method, string $url, ?array $json = null): array
{
    for ($attempt = 0; $attempt < 2; $attempt++) {
        $headers = [
            'Authorization: Bearer ' . cl_access_token(),
            'Accept: application/json',
        ];
        $body = null;
        if ($json !== null) {
            $headers[] = 'Content-Type: application/json';
            $body = json_encode($json);
        }
        [$status, $resp] = cl_http($method, $url, $headers, $body);
        if (($status === 401 || $status === 403) && $attempt === 0) {
            cl_refresh();
            continue;
        }
        if ($status < 200 || $status >= 300) {
            throw new RuntimeException("CareLink hiba: HTTP $status (" . parse_url($url, PHP_URL_PATH) . ')');
        }
        $data = cl_json($resp);
        if ($data === null && trim($resp) !== '' && trim($resp) !== 'null') {
            throw new RuntimeException('A CareLink nem JSON választ adott (' . parse_url($url, PHP_URL_PATH) . ').');
        }
        return $data ?? [];
    }
    throw new RuntimeException('CareLink: a hitelesítés nem sikerült.');
}

/** Fiókadatok: szerepkör, felhasználónév, követett páciensek (6 óráig tárolva). */
function cl_session(bool $force = false): array
{
    $s = cl_state();
    if (!$force && !empty($s['session']) && ($s['session_at'] ?? 0) > time() - 6 * 3600) {
        return $s['session'];
    }
    $c = cl_config();
    $base = 'https://' . $c['carelink_host'];
    $user = cl_api('GET', $base . '/patient/users/me');
    $profile = cl_api('GET', $base . '/patient/users/me/profile');
    $role = (string) ($user['role'] ?? '');
    $isCarePartner = in_array($role, ['CARE_PARTNER', 'CARE_PARTNER_OUS'], true);
    $m2m = false;
    try {
        $m2m = (bool) (cl_api('GET', $base . '/patient/configuration/system/personal.cp.m2m.enabled')['value'] ?? false);
    } catch (RuntimeException $e) {
        $m2m = false;
    }
    $patients = [];
    if ($isCarePartner && $m2m) {
        foreach (cl_api('GET', $base . '/patient/m2m/links/patients') as $p) {
            if (is_array($p) && !empty($p['username'])) {
                $patients[] = [
                    'username' => (string) $p['username'],
                    'name' => trim(($p['firstName'] ?? '') . ' ' . ($p['lastName'] ?? '')),
                    'device' => (string) ($p['lastDeviceFamily'] ?? ''),
                    'status' => (string) ($p['status'] ?? ''),
                ];
            }
        }
    }
    $session = [
        'username' => (string) ($profile['username'] ?? ''),
        'name' => trim(($user['firstName'] ?? '') . ' ' . ($user['lastName'] ?? '')),
        'role' => $role,
        'care_partner' => $isCarePartner,
        'm2m' => $m2m,
        'patients' => $patients,
    ];
    cl_save(['session' => $session, 'session_at' => time()]);
    return $session;
}

/** Időbélyeg a CareLink dátumszövegéből; időzóna nélkül helyi (Europe/Budapest) időnek veszi. */
function cl_parse_time($value): ?int
{
    if (is_int($value) || is_float($value)) {
        return $value > 1e11 ? (int) ($value / 1000) : (int) $value;
    }
    if (!is_string($value) || trim($value) === '') {
        return null;
    }
    try {
        return (new DateTime($value))->getTimestamp();
    } catch (Exception $e) {
        return null;
    }
}

/** A nyers CareLink válaszból glükóz sorok (mmol/L), az xDrip-hez hasonló időzóna-javítással. */
function cl_extract_glucose(array $data): array
{
    $pd = isset($data['patientData']) && is_array($data['patientData']) ? $data['patientData'] : $data;
    $sgs = $pd['sgs'] ?? [];
    if (!is_array($sgs)) {
        return [];
    }

    // Ha a készülék ideje és a szerver ideje órákban eltér (rossz időzóna jelölés), eltoljuk.
    $shift = 0;
    $serverMs = $pd['lastMedicalDeviceDataUpdateServerTime'] ?? ($pd['lastConduitUpdateServerDateTime'] ?? null);
    $lastSg = $pd['lastSG'] ?? null;
    $lastTs = is_array($lastSg) ? cl_parse_time($lastSg['datetime'] ?? ($lastSg['timestamp'] ?? null)) : null;
    if (is_numeric($serverMs) && $serverMs > 1 && $lastTs) {
        $diffHours = (int) round(((float) $serverMs / 1000 - $lastTs) / 3600);
        if ($diffHours !== 0 && abs($diffHours) < 26) {
            $shift = $diffHours * 3600;
        }
    }

    $rows = [];
    foreach ($sgs as $sg) {
        if (!is_array($sg)) {
            continue;
        }
        $mgdl = $sg['sg'] ?? null;
        if (!is_numeric($mgdl) || $mgdl <= 0) {
            continue; // 0 = nincs érték (bemelegedés, kalibráció stb.)
        }
        $ts = cl_parse_time($sg['datetime'] ?? ($sg['timestamp'] ?? null));
        if ($ts === null) {
            continue;
        }
        $ts += $shift;
        $mmol = round((float) $mgdl / MGDL_PER_MMOL, 1);
        if ($mmol < 1 || $mmol > 35 || $ts > time() + 600) {
            continue;
        }
        $rows[] = ['type' => 'glucose', 'ts' => $ts, 'value' => $mmol, 'subtype' => null, 'source' => 'CareLink'];
    }
    return $rows;
}

/** Az aktuális 24 órás adatcsomag lekérése a fiók típusától függően. */
function cl_fetch_recent(): array
{
    $c = cl_config();
    $session = cl_session();
    $cloud = 'https://' . $c['cloud_host'];

    if ($session['care_partner'] && $session['m2m']) {
        $chosen = (string) (cl_state()['patient'] ?? '');
        $patient = null;
        foreach ($session['patients'] as $p) {
            if ($chosen === '' || $p['username'] === $chosen) {
                $patient = $p;
                break;
            }
        }
        if (!$patient) {
            throw new RuntimeException('A gondozói fiók nem követ egy pácienst sem. A CareLinkben fogadd el a követési meghívást.');
        }
        $family = strtoupper($patient['device']);
        if (strpos($family, 'BLE') !== false || strpos($family, 'SIMPLERA') !== false) {
            // MiniMed 7xxG pumpa / Simplera: Cumulus display/message végpont
            return cl_api('POST', $c['cumulus_base'] . '/display/message', [
                'username' => $session['username'],
                'role' => 'carepartner',
                'patientId' => $patient['username'],
                'appVersion' => '3.8.0',
            ]);
        }
        // Önálló Guardian szenzor (Guardian 4 / Guardian Connect)
        return cl_api('GET', $cloud . '/patient/m2m/connect/data/gc/patients/' . rawurlencode($patient['username']));
    }

    // Saját (páciens) fiók vagy egyszerű követés
    return cl_api('GET', $cloud . '/patient/connect/data');
}

/** Egy lekérés: adatok le, mentés, állapot rögzítése. Visszaadja az összegzést. */
function cl_poll(): array
{
    if (!cl_is_connected()) {
        return ['ok' => false, 'error' => 'Nincs CareLink kapcsolat.'];
    }
    // Egyszerre csak egy lekérés fusson (háttérfolyamat és „Lekérés most” gomb), különben
    // két párhuzamos tokenfrissítés érvénytelenítheti a belépést.
    $lock = fopen(DATA_DIR . '/carelink.lock', 'c');
    if ($lock) {
        flock($lock, LOCK_EX);
    }
    cl_save(['last_poll_at' => time()]);
    try {
        $data = cl_fetch_recent();
        @file_put_contents(DATA_DIR . '/' . CL_RAW_FILE, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        $rows = cl_extract_glucose($data);
        [$inserted, $duplicates] = store_rows($rows);
        $latest = $rows ? max(array_column($rows, 'ts')) : null;
        cl_save([
            'last_ok_at' => time(),
            'last_error' => null,
            'last_count' => count($rows),
            'last_inserted' => $inserted,
            'last_sg_at' => $latest,
        ]);
        return ['ok' => true, 'received' => count($rows), 'inserted' => $inserted, 'duplicates' => $duplicates, 'latest' => $latest];
    } catch (Throwable $e) {
        cl_save(['last_error' => $e->getMessage(), 'last_error_at' => time()]);
        return ['ok' => false, 'error' => $e->getMessage()];
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}

/**
 * WAMP alatt nincs háttérfolyamat: oldalbetöltéskor kérjük le, ha régi az adat.
 * Dockerben ezt a háttérben futó carelink_poll.php végzi (CARELINK_POLLER=1).
 */
function cl_poll_if_stale(int $maxAge = 300): void
{
    if (getenv('CARELINK_POLLER') === '1' || !cl_is_connected()) {
        return;
    }
    if ((cl_state()['last_poll_at'] ?? 0) < time() - $maxAge) {
        cl_poll();
    }
}
