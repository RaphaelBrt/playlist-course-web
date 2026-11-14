// Rotation des thèmes à répétition espacée, portage de internal/plan/theme.go.
import { type Concept, type Config, type Theme, themeParId } from './config';
import { type Historique, derniere } from './historique';

export interface Choix { theme: Theme; passage: number; raison: string; concepts: Concept[]; question: string }

function lies(a: Theme, b: Theme): boolean {
  return a.echos.includes(b.id) || b.echos.includes(a.id);
}

/**
 * Un thème déjà vu redevient éligible après espacement[passages] courses ;
 * un rappel dû passe avant un thème neuf ; on préfère un thème lié (écho)
 * au précédent, d'une autre famille ; jamais deux fois de suite le même thème.
 * Déterministe pour un historique donné.
 */
export function choisirTheme(cfg: Config, h: Historique, force = ''): Choix {
  const n = h.courses.length;
  const passages = new Map<string, number>(), dernier = new Map<string, number>();
  h.courses.forEach((c, i) => { passages.set(c.theme_id, (passages.get(c.theme_id) ?? 0) + 1); dernier.set(c.theme_id, i); });
  const d = derniere(h);
  const prec = d ? themeParId(cfg, d.theme_id) : undefined;
  const construire = (t: Theme, raison: string): Choix => {
    const p = (passages.get(t.id) ?? 0) + 1;
    return { theme: t, passage: p, raison, concepts: conceptsDuPassage(t, p), question: t.questions[(p - 1) % t.questions.length] };
  };
  if (force) {
    const t = themeParId(cfg, force);
    if (!t) throw new Error(`Thème inconnu : « ${force} ».`);
    return construire(t, 'thème imposé');
  }
  const esp = cfg.espacement_courses;
  const ecart = (id: string) => {
    const p = passages.get(id) ?? 0;
    if (p === 0) return 0;
    return p >= esp.length ? esp[esp.length - 1] : esp[p];
  };
  let meilleur: Theme | undefined, meilleurScore = -(2 ** 30) * 100, raison = '';
  cfg.themes.forEach((t, i) => {
    if (prec && t.id === prec.id) return;
    const p = passages.get(t.id) ?? 0;
    const depuis = dernier.has(t.id) ? n - (dernier.get(t.id) as number) : n + 1000;
    const eligible = p === 0 || depuis >= ecart(t.id);
    let score: number, r: string;
    if (eligible && p > 0) { score = 1000 + (depuis - ecart(t.id)); r = `rappel espacé (passage ${p + 1}, ${depuis} courses après le précédent)`; }
    else if (eligible) { score = 800; r = 'nouveau thème'; }
    else { score = -1000 + (depuis - ecart(t.id)); r = 'aucun thème éligible : le moins en retard'; }
    if (prec) {
      if (lies(prec, t)) { score += 60; r += ', en écho au thème précédent'; }
      if (t.famille === prec.famille) score -= 40;
    }
    score = score * 100 - i; // départage stable par l'ordre du profil
    if (score > meilleurScore) { meilleurScore = score; meilleur = t; raison = r; }
  });
  if (!meilleur) throw new Error('Aucun thème disponible.');
  return construire(meilleur, raison);
}

/** Trois concepts, décalés à chaque passage quand le thème en compte plus de trois. */
export function conceptsDuPassage(t: Theme, passage: number): Concept[] {
  const n = t.concepts.length;
  if (n <= 3) return t.concepts;
  return [0, 1, 2].map((k) => t.concepts[(passage - 1 + k) % n]);
}
