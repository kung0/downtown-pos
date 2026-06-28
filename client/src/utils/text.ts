// Fold diacritics so search matches regardless of Vietnamese tone marks etc.
// "Bánh mì" → "banh mi", "phở" → "pho". Mirrors the printer's enc() stripping
// so what you can search matches what prints.
export function foldDiacritics(s: string): string {
  return s
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .toLowerCase();
}
