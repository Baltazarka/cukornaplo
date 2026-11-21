// A napi mentések megőrzése: a névben lévő dátum szerint a legrégebbieket jelöli törlésre, fajtánként (adatbázis,
// beállítások) az utolsó `keep` marad.
const KINDS = [/^diabetes-\d{4}-\d{2}-\d{2}\.sqlite$/, /^settings-\d{4}-\d{2}-\d{2}\.json$/]

export function staleBackups(files: string[], keep: number): string[] {
  return KINDS.flatMap((re) => files.filter((f) => re.test(f)).sort().slice(0, -keep))
}
