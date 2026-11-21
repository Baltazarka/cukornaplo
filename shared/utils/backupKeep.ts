// A napi mentések megőrzése: a névben lévő dátum szerint a legrégebbieket jelöli törlésre, az utolsó `keep` marad.
const NAME = /^diabetes-\d{4}-\d{2}-\d{2}\.sqlite$/

export function staleBackups(files: string[], keep: number): string[] {
  return files.filter((f) => NAME.test(f)).sort().slice(0, -keep)
}
