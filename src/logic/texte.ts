// Normalisation de chaînes (casse, accents, ponctuation), portage de internal/texte.
const accents: Record<string, string> = {
  'à': 'a', 'â': 'a', 'ä': 'a', 'á': 'a', 'ã': 'a', 'å': 'a',
  'ç': 'c', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'î': 'i', 'ï': 'i', 'í': 'i', 'ì': 'i',
  'ô': 'o', 'ö': 'o', 'ó': 'o', 'ò': 'o', 'õ': 'o', 'ø': 'o',
  'ù': 'u', 'û': 'u', 'ü': 'u', 'ú': 'u', 'ÿ': 'y', 'ñ': 'n',
  'œ': 'oe', 'æ': 'ae', 'ß': 'ss',
};
const lettreOuChiffre = /[\p{L}\p{N}]/u;

/** Minuscules, sans accents, ponctuation remplacée par une espace, espaces réduites. */
export function normaliser(s: string): string {
  let out = '';
  for (const r of (s ?? '').toLowerCase()) {
    const rep = accents[r];
    if (rep !== undefined) out += rep;
    else if (lettreOuChiffre.test(r)) out += r;
    else out += ' ';
  }
  return out.split(/\s+/).filter(Boolean).join(' ');
}

/** La forme normalisée de botte contient celle d'aiguille, mot entier. */
export function contient(botte: string, aiguille: string): boolean {
  const a = normaliser(aiguille);
  if (!a) return false;
  return (' ' + normaliser(botte) + ' ').includes(' ' + a + ' ');
}

/** Coupe s à n caractères au plus, avec « … » si nécessaire. */
export function tronquer(s: string, n: number): string {
  const r = Array.from(s);
  if (r.length <= n) return s;
  if (n <= 1) return r.slice(0, n).join('');
  return r.slice(0, n - 1).join('').trim() + '…';
}
