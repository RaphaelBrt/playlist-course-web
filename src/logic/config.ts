// Profil d'intérêts (interets.json), portage de internal/config.
export interface Concept { nom: string; definition: string }
export interface Morceau { artiste: string; titre: string; pourquoi?: string; annee?: number; spotify_id?: string }
export interface Theme {
  id: string; titre: string; famille: string; paradoxe: string;
  concepts: Concept[]; questions: string[];
  mots_cles: Record<string, string[]>; musique: Morceau[]; echos: string[];
}
export interface Emission { nom: string; bloc: string; langue: string }
export interface Bloc {
  id: string; libelle: string; duree_min_min: number; duree_max_min: number;
  fraicheur_jours: number; fraicheur_repli_jours: number;
}
export interface Structure {
  echauffement_min_min: number; blocs_parles: Bloc[]; parole_max_min: number;
  retour_au_calme_min_min: number; morceau_max_min?: number;
}
export interface Config {
  version: number; marche: string; duree_cible_min: number; tolerance_min: number;
  langues: string[]; playlist_publique: boolean; espacement_courses: number[];
  structure: Structure; emissions: Emission[]; musique_generale: Morceau[]; themes: Theme[];
  recherche_ouverte: boolean; emissions_exclues: string[];
}

export class ProfilInvalide extends Error {
  constructor(public erreurs: string[]) {
    super('profil invalide :\n- ' + erreurs.join('\n- '));
  }
}

/** Décode et valide un profil (mêmes règles que verifier-profil). */
export function analyser(brut: unknown): Config {
  if (!brut || typeof brut !== 'object') throw new ProfilInvalide(['profil illisible : objet JSON attendu']);
  const c = brut as Config;
  c.langues ??= []; c.emissions ??= []; c.musique_generale ??= []; c.themes ??= [];
  c.emissions_exclues ??= []; c.structure ??= { echauffement_min_min: 0, blocs_parles: [], parole_max_min: 0, retour_au_calme_min_min: 0 };
  c.structure.blocs_parles ??= [];
  for (const t of c.themes) { t.concepts ??= []; t.questions ??= []; t.musique ??= []; t.echos ??= []; t.mots_cles ??= {}; }
  valider(c);
  return c;
}

export function valider(c: Config): void {
  const errs: string[] = [];
  if (typeof c.marche !== 'string' || c.marche.length !== 2) errs.push('marche : code pays à deux lettres attendu (ex. FR)');
  if (!(c.duree_cible_min >= 10 && c.duree_cible_min <= 240)) errs.push('duree_cible_min : entre 10 et 240');
  if (!(c.tolerance_min >= 1 && c.tolerance_min <= 15)) errs.push('tolerance_min : entre 1 et 15');
  if (c.themes.length < 2) errs.push('themes : au moins deux thèmes');
  if (!c.espacement_courses || c.espacement_courses.length === 0) c.espacement_courses = [0, 4, 8, 16];
  const blocs = new Set<string>();
  for (const b of c.structure.blocs_parles) {
    if (!b.id || !(b.duree_min_min >= 1) || !(b.duree_max_min >= b.duree_min_min))
      errs.push(`bloc « ${b.id} » : id, duree_min_min ≥ 1 et duree_max_min ≥ duree_min_min requis`);
    blocs.add(b.id);
  }
  const ids = new Set<string>();
  for (const t of c.themes) {
    if (!t.id || ids.has(t.id)) errs.push(`thème « ${t.id} » : identifiant vide ou en double`);
    ids.add(t.id);
    if (!t.titre || !t.paradoxe) errs.push(`thème « ${t.id} » : titre et paradoxe requis`);
    if (t.concepts.length < 3) errs.push(`thème « ${t.id} » : au moins trois concepts`);
    if (t.questions.length === 0) errs.push(`thème « ${t.id} » : au moins une question`);
    if (t.musique.length < 2) errs.push(`thème « ${t.id} » : au moins deux morceaux`);
  }
  for (const t of c.themes) for (const e of t.echos)
    if (!ids.has(e)) errs.push(`thème « ${t.id} » : écho vers un thème inconnu « ${e} »`);
  for (const e of c.emissions)
    if (!blocs.has(e.bloc)) errs.push(`émission « ${e.nom} » : bloc inconnu « ${e.bloc} »`);
  if (errs.length) throw new ProfilInvalide(errs);
}

export function themeParId(c: Config, id: string): Theme | undefined {
  return c.themes.find((t) => t.id === id);
}
