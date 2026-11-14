// Historique des courses, même schéma JSON que historique.json du programme Go
// (import et export interchangeables).
export interface ElementHisto { uri: string; type: string; nom: string; auteur: string; duree_ms: number }
export interface Course {
  numero: number; date: string; theme_id: string; theme_titre: string; paradoxe: string;
  passage: number; concepts: string[]; definitions: string[]; question: string;
  playlist_id: string; playlist_url: string; duree_ms: number;
  elements: ElementHisto[]; motif?: ElementHisto | null;
}
export interface Historique { courses: Course[] }

export const historiqueVide = (): Historique => ({ courses: [] });

export function derniere(h: Historique): Course | undefined {
  return h.courses.length ? h.courses[h.courses.length - 1] : undefined;
}

/** Course n−k (k ≥ 1), ou undefined. */
export function ilYa(h: Historique, k: number): Course | undefined {
  const i = h.courses.length - k;
  if (k < 1 || i < 0) return undefined;
  return h.courses[i];
}

/** URI d'épisodes déjà diffusés (toutes courses) et de morceaux des n dernières courses. */
export function dejaJoues(h: Historique, nMorceaux: number): { episodes: Set<string>; morceaux: Set<string> } {
  const episodes = new Set<string>(), morceaux = new Set<string>();
  h.courses.forEach((c, i) => {
    const recent = i >= h.courses.length - nMorceaux;
    for (const e of c.elements ?? []) {
      if (e.type === 'episode') episodes.add(e.uri);
      else if (recent) morceaux.add(e.uri);
    }
  });
  return { episodes, morceaux };
}

/** Contrôle minimal d'un historique importé (fichier du programme Go ou export de l'app). */
export function lireHistorique(brut: unknown): Historique {
  if (!brut || typeof brut !== 'object' || !Array.isArray((brut as Historique).courses))
    throw new Error('Fichier non reconnu : un objet { "courses": [...] } est attendu.');
  const h = brut as Historique;
  for (const [i, c] of h.courses.entries()) {
    if (typeof c.numero !== 'number' || typeof c.theme_id !== 'string')
      throw new Error(`Course ${i + 1} : « numero » et « theme_id » sont requis.`);
    c.elements ??= []; c.concepts ??= []; c.definitions ??= [];
  }
  return h;
}
