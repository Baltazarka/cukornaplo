// A szénhidrát-jelölések ikonja (napló, grafikonok, riport) és magyarázata (tooltip a jelölőkön).
export const CARB_TAG_ICON = { fatty: '🧀', fast: '⚡' } as const

// A szénhidrát-jelölések magyarázata: mikor zsíros, mikor normál, mikor gyors.
export const CARB_TAG_HINT = {
  normal:
    'Normál: a szénhidrát a szokásos ütemben szívódik fel. Ide tartozik a kevés CH-s, de zsíros / fehérjés étel is '
    + '(pl. virsli kenyérrel): a kevés CH normálisan szívódik fel. A zsír / fehérje késői (3–5 órás) emelésére '
    + 'a „zsíros” jelölésnél a bóluskalkulátor tájékoztató plusz-javaslatot ír ki a zsír- és fehérjegrammból.',
  fatty:
    'Zsíros / fehérjedús: a zsír és a fehérje később (1–1,5 óra múlva, órákig) emel. Akkor jelöld, ha kb. 2 zsír-fehérje '
    + 'egység van benne (kb. 15 g zsír + 15 g fehérje, vagy 20 g zsír), pl. pizza, hamburger, rántott hús, párizsi, '
    + 'tejszínes tészta; 1–2 egység határeset, 1 alatt ne jelöld. Add meg a zsír és a fehérje grammját is: a kalkulátor '
    + 'tájékoztató plusz-javaslatot és emlékeztetőt ad. A CH-arány becslése kihagyja. Példák: Számítások → Zsíros ételek.',
  fast:
    'Gyors CH (pl. hipó kezelése, gyümölcslé, szőlőcukor): hamar emel és hamar lecseng. A hipó kezelésére bevitt CH-t '
    + 'is így írd be: ettől tudja a hipó-értesítés, hogy kezelted.',
} as const
