<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/layout.php';

start_session();

if (!setting('password_hash')) {
    redirect('setup.php');
}
if (!empty($_SESSION['auth'])) {
    redirect('');
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    check_csrf();
    $wait = login_locked_for();
    if ($wait > 0) {
        $error = 'Túl sok hibás próbálkozás. Próbáld újra ' . (int) ceil($wait / 60) . ' perc múlva.';
    } elseif (password_verify((string) ($_POST['password'] ?? ''), (string) setting('password_hash'))) {
        login_succeeded();
        session_regenerate_id(true);
        $_SESSION['auth'] = true;
        redirect('');
    } else {
        login_failed();
        sleep(1);
        $error = 'Hibás jelszó.';
    }
}

page_header('Belépés');
?>
<section class="card narrow">
  <h1>Belépés</h1>
  <?php if ($error): ?><p class="alert"><?= h($error) ?></p><?php endif; ?>
  <form method="post" class="stack">
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <label>Jelszó <input type="password" name="password" autocomplete="current-password" required autofocus></label>
    <button type="submit">Belépés</button>
  </form>
</section>
<?php
page_footer();
