// A szénhidrát-jelölések ikonja (napló, grafikonok, riport) és magyarázata (tooltip a jelölőkön).
export const CARB_TAG_ICON = { fatty: '🧀', fast: '⚡' } as const

// A szénhidrát-jelölések magyarázata: mikor zsíros, mikor normál, mikor gyors.
export const CARB_TAG_HINT = {
  normal:
    'Normál: a szénhidrát a szokásos ütemben szívódik fel. Ide tartozik a kevés CH-s, de zsíros / fehérjés étel is '
    + '(pl. virsli kenyérrel): a kevés CH normálisan szívódik fel. A zsír / fehérje késői (3–5 órás) emelésére '
    + 'a „zsíros” jelölésnél a bóluskalkulátor tájékoztató plusz-javaslatot ír ki a zsír- és fehérjegrammból.',
  fatty:
    'Zsíros / fehérjedús: a szénhidrát lassabban szívódik fel. Akkor jelöld, ha kb. 40 g-nál több zsír (vagy 30–40 g-nál '
    + 'több fehérje) van az ételben ÉS számottevő a CH is (kb. 30 g fölött), pl. pizza, rántott étel körettel, tejszínes '
    + 'tészta. 20 g zsír alatt általában nem számít, 20–40 g között enyhén lassíthat. A határ egyéni: ha egy étel után '
    + '3–5 óra múlva rendszeresen emelkedik, nálad zsírosnak számít. A CH-arány becslése kihagyja. A bóluskalkulátorban '
    + 'megadhatod a zsír és a fehérje grammját is: tájékoztatásul kiírja, mennyi plusz inzulin jönne ki rá (varsói módszer).',
  fast:
    'Gyors CH (pl. hipó kezelése, gyümölcslé, szőlőcukor): hamar emel és hamar lecseng. A hipó kezelésére bevitt CH-t '
    + 'is így írd be: ettől tudja a hipó-értesítés, hogy kezelted.',
} as const
