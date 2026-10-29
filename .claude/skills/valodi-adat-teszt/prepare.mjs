// Ideiglenes adatmappa a füstpróbához a legfrissebb letöltött másolatból (data/cukornaplo-*.sqlite):
//   node .claude/skills/valodi-adat-teszt/prepare.mjs <célmappa> [export.sqlite]
// A scripts/use-export.mjs-t hívja, majd törli a jelszó-hasht és a beállító kódot, hogy a smoke.mjs új jelszót adhasson.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const [target, given] = process.argv.slice(2)
if (!target) { console.error('Használat: node prepare.mjs <célmappa> [export.sqlite]'); process.exit(1) }
const src = given || readdirSync('data').filter((f) => /^cukornaplo-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().map((f) => join('data', f)).pop()
if (!src || !existsSync(src)) { console.error('Nincs letöltött másolat a data/ mappában (Beállítások → adatbázis letöltése).'); process.exit(1) }
console.log(`Forrás: ${src}`)
execFileSync(process.execPath, ['scripts/use-export.mjs', src, target], { stdio: 'inherit' })
const f = join(target, 'settings.json')
const s = JSON.parse(readFileSync(f, 'utf8'))
delete s.password_hash
delete s.setup_code
writeFileSync(f, JSON.stringify(s, null, 2))
console.log('Jelszó és beállító kód törölve a másolatból.')
