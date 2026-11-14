// Assemblage d'une course de 60 ± 3 min, portage de internal/plan/assemblage.go.

/** Morceau ou épisode réellement renvoyé par l'API. */
export interface Candidat {
  type: 'track' | 'episode';
  uri: string; id: string; nom: string;
  auteur: string; // artiste ou émission
  duree_ms: number; url: string;
  date_sortie?: string;
  age_jours: number; // -1 si inconnu
  score: number;
  note?: string;
  theme?: boolean; // morceau du thème (et non du fonds général)
}

export type IdBloc = 'echauffement' | 'intermede' | 'retour_au_calme' | string;
export interface Element extends Candidat { bloc: IdBloc; libelle: string; debut_ms: number }
export interface BlocParle { id: string; libelle: string; min_ms: number; max_ms: number }

export interface Entrees {
  cible_ms: number; tolerance_ms: number; echauffement_ms: number; parole_max_ms: number;
  retour_calme_min_ms: number; blocs: BlocParle[];
  episodes: Record<string, Candidat[]>; // par bloc, triés par score décroissant
  echo?: Candidat | null; // morceau qui fermait la course précédente
  morceaux_theme: Candidat[]; fonds: Candidat[]; exclus: Set<string>;
  morceau_max_ms: number; // 0 : sans limite
}

export interface Plan { elements: Element[]; total_ms: number; blocs_vides: string[] }

export class ErreurAjustement extends Error {
  constructor(detail = '') {
    super("Impossible d'atteindre la durée cible avec les morceaux disponibles" + (detail ? ` (${detail})` : ''));
  }
}

const INTERMEDE_ESTIME_MS = 4 * 60 * 1000;

/**
 * Échauffement musical, blocs parlés séparés par un intermède, retour au calme
 * ajusté pour finir dans [cible − tolérance, cible + tolérance]. Un épisode trop
 * long pour le temps restant est remplacé par le suivant : rien n'est coupé.
 */
export function assembler(e: Entrees): Plan {
  const p: Plan = { elements: [], total_ms: 0, blocs_vides: [] };
  const utilises = new Set<string>(e.exclus);
  const ajouter = (c: Candidat, bloc: string, libelle: string) => {
    p.elements.push({ ...c, bloc, libelle, debut_ms: p.total_ms });
    p.total_ms += c.duree_ms;
    utilises.add(c.uri);
  };
  const possible = (c: Candidat) => !utilises.has(c.uri) && (e.morceau_max_ms <= 0 || c.duree_ms <= e.morceau_max_ms);
  const musique = () => [...e.morceaux_theme.filter(possible), ...e.fonds.filter(possible)];
  const max = e.cible_ms + e.tolerance_ms;

  // 1. Échauffement : l'écho de la course précédente, puis les morceaux du thème.
  if (e.echo && !utilises.has(e.echo.uri)) ajouter({ ...e.echo, note: 'écho de la course précédente' }, 'echauffement', 'Échauffement');
  while (p.total_ms < e.echauffement_ms) {
    const m = musique();
    if (!m.length) throw new ErreurAjustement('échauffement');
    ajouter(m[0], 'echauffement', 'Échauffement');
  }

  // 2. Blocs parlés et intermèdes.
  let parole = 0;
  e.blocs.forEach((b, i) => {
    const restants = e.blocs.length - i - 1;
    const reserve = restants * INTERMEDE_ESTIME_MS + e.retour_calme_min_ms;
    const budget = Math.min(max - p.total_ms - reserve, e.parole_max_ms - parole);
    const c = (e.episodes[b.id] ?? []).find((c) => !utilises.has(c.uri) && c.duree_ms >= b.min_ms && c.duree_ms <= b.max_ms && c.duree_ms <= budget);
    if (!c) { p.blocs_vides.push(b.id); return; }
    ajouter(c, b.id, b.libelle);
    parole += c.duree_ms;
    if (restants > 0) {
      const m = musique().find((m) => p.total_ms + m.duree_ms + e.retour_calme_min_ms <= max);
      if (m) ajouter(m, 'intermede', 'Intermède');
    }
  });

  // 3. Retour au calme : sous-ensemble de morceaux au plus près de la cible.
  let bas = e.cible_ms - e.tolerance_ms - p.total_ms;
  const haut = max - p.total_ms;
  if (haut <= 0) throw new ErreurAjustement('dépassement avant le retour au calme');
  if (bas < e.retour_calme_min_ms) bas = e.retour_calme_min_ms;
  const choix = sousEnsemble(musique(), bas, haut, e.cible_ms - p.total_ms, 8);
  if (!choix) throw new ErreurAjustement();
  for (const c of choix) ajouter(c, 'retour_au_calme', 'Retour au calme');
  if (p.total_ms < e.cible_ms - e.tolerance_ms || p.total_ms > max) throw new ErreurAjustement();
  return p;
}

/**
 * Au plus maxN morceaux dont la somme est dans [bas, haut], au plus près de
 * cible ; pénalité de 30 s par morceau (préférer moins de morceaux).
 * Programmation dynamique à la seconde, 40 candidats au plus.
 */
export function sousEnsemble(c: Candidat[], bas: number, haut: number, cible: number, maxN: number): Candidat[] | null {
  if (c.length > 40) c = c.slice(0, 40);
  const H = Math.floor(haut / 1000);
  if (H < 0) return null;
  const L = H + 1;
  // État (k, s) : atteint avec exactement k morceaux pour la somme s (secondes).
  const ok = new Uint8Array((maxN + 1) * L);
  const prevS = new Int32Array((maxN + 1) * L);
  const item = new Int32Array((maxN + 1) * L);
  ok[0] = 1;
  c.forEach((m, i) => {
    const d = Math.floor(m.duree_ms / 1000);
    if (d <= 0) return;
    for (let k = maxN - 1; k >= 0; k--) {
      for (let s = H - d; s >= 0; s--) {
        const de = k * L + s, vers = (k + 1) * L + s + d;
        if (ok[de] && !ok[vers]) { ok[vers] = 1; prevS[vers] = s; item[vers] = i; }
      }
    }
  });
  const remonter = (k: number, s: number) => {
    const idx: number[] = [];
    while (k > 0) { const j = k * L + s; idx.push(item[j]); s = prevS[j]; k--; }
    return idx;
  };
  let meilleurK = -1, meilleurS = -1, meilleurEcart = 2 ** 30;
  for (let k = 1; k <= maxN; k++) {
    for (let s = 0; s <= H; s++) {
      if (!ok[k * L + s]) continue;
      const tot = remonter(k, s).reduce((a, i) => a + c[i].duree_ms, 0); // somme exacte en ms
      if (tot < bas || tot > haut) continue;
      const ec = Math.abs(tot - cible) + 30000 * k;
      if (ec < meilleurEcart) { meilleurEcart = ec; meilleurK = k; meilleurS = s; }
    }
  }
  if (meilleurK < 0) return null;
  return remonter(meilleurK, meilleurS).sort((a, b) => a - b).map((i) => c[i]);
}
