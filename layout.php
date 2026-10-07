<?php
// Oldal fejléc / lábléc és apró közös elemek.

declare(strict_types=1);

function page_header(string $title, string $active = ''): void
{
    $base = app_path();
    $loggedIn = !empty($_SESSION['auth']);
    ?>
<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($title) ?> · Cukornapló</title>
<link rel="stylesheet" href="<?= h($base) ?>/assets/app.css?v=5">
</head>
<body>
<header class="topbar">
  <a class="brand" href="<?= h($base) ?>/">Cukornapló</a>
  <?php if ($loggedIn): ?>
  <nav>
    <a href="<?= h($base) ?>/" class="<?= $active === 'day' ? 'active' : '' ?>">Napi nézet</a>
    <a href="<?= h($base) ?>/setup.php?step=2" class="<?= $active === 'setup' ? 'active' : '' ?>">Telefon beállítása</a>
    <a href="<?= h($base) ?>/settings.php" class="<?= $active === 'settings' ? 'active' : '' ?>">Adatok és import</a>
    <a href="<?= h($base) ?>/logout.php">Kilépés</a>
  </nav>
  <?php endif; ?>
</header>
<main>
<?php
}

function page_footer(): void
{
    ?>
</main>
<script>
// Másolás gombok: data-copy-text attribútum tartalmát teszi a vágólapra.
document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('[data-copy-text]');
  if (!btn) return;
  var text = btn.getAttribute('data-copy-text');
  function done() {
    var old = btn.textContent;
    btn.textContent = 'Másolva ✓';
    setTimeout(function () { btn.textContent = old; }, 1500);
  }
  // http-n (nem localhost) a navigator.clipboard nem elérhető, ott a régi módszer kell.
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done);
  } else {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    done();
  }
});
</script>
</body>
</html>
<?php
}

/** Kimásolható érték: kódként megjelenítve, mellette Másolás gomb. */
function copy_chip(string $value): string
{
    return '<span class="chip"><code>' . h($value) . '</code><button type="button" class="ghost sm" data-copy-text="' . h($value) . '">Másolás</button></span>';
}
