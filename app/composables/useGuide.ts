// A számítások magyarázata: oldalról beúszó panel. Az érték a megnyitandó szakasz azonosítója,
// vagy false, ha zárva van.
export const useGuide = () => useState<string | false>('guide', () => false)

export function openGuide(section = 'tartalom') {
  useGuide().value = section
}
