// Fiche de course et textes de la playlist, portage de internal/fiche.
import type { Plan } from './assemblage';
import type { Concept } from './config';
import type { Choix } from './theme';
import { type Course, type Historique, ilYa } from './historique';
import { tronquer } from './texte';

export interface Rappel { course: number; titre: string; concept: string; definition: string }

export interface Donnees {
  numero: number; date: Date; choix: Choix; precedente?: Course; rappels: Rappel[];
  plan: Plan; total_ms: number; total_relu: boolean; playlist_url?: string;
  apercu: boolean; marche: string; lu_le: Date; problemes?: string[]; journal?: string[];
}

export const num3 = (n: number) => String(n).padStart(3, '0');

export function duree(ms: number): string {
  const s = Math.floor((ms + 500) / 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${p2(Math.floor((s % 3600) / 60))} min ${p2(s % 60)} s`;
  return `${Math.floor(s / 60)} min ${p2(s % 60)} s`;
}

/** Minutes arrondies pour l'affichage compact (« 57 min »). */
export const minutes = (ms: number) => Math.round(ms / 60000);

export function horloge(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtCourt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtHeure = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
export const dateFr = (d: Date) => fmtDate.format(d);
export const dateCourte = (d: Date) => fmtCourt.format(d);

/** « Course 007 · Dissuasion · 14/11/2026 », 100 caractères au plus. */
export function nomPlaylist(d: Pick<Donnees, 'numero' | 'choix' | 'date'>): string {
  return tronquer(`Course ${num3(d.numero)} · ${d.choix.theme.titre} · ${dateCourte(d.date)}`, 100);
}

/** Description d'une ligne, 300 caractères au plus. */
export function description(d: Pick<Donnees, 'choix' | 'precedente'>): string {
  const t = d.choix.theme;
  let s = `Paradoxe : ${t.paradoxe} Concepts : ${d.choix.concepts.map((c) => c.nom).join(', ')}. Question : ${d.choix.question}`;
  if (d.precedente) s += ` Écho : course ${num3(d.precedente.numero)}, ${d.precedente.theme_titre}.`;
  s = s.replace(/[\r\n]/g, ' ').replace(/</g, '‹').replace(/>/g, '›');
  return tronquer(s, 300);
}

export interface Pont { premiere: boolean; texte: string; liaison?: string; precedente?: Course }

/** La phrase qui relie la course à la précédente, et la question de liaison. */
export function pont(d: Pick<Donnees, 'choix' | 'precedente'>): Pont {
  const p = d.precedente;
  if (!p) return { premiere: true, texte: 'Première course du programme : pas encore d’écho.' };
  const r: Pont = { premiere: false, precedente: p,
    texte: `Course ${num3(p.numero)}, « ${p.theme_titre} » : ${p.paradoxe} Aujourd’hui : ${d.choix.theme.paradoxe}` };
  const concept = p.concepts?.[0];
  if (concept && d.choix.concepts.length) r.liaison = `En quoi « ${concept} » éclaire-t-il « ${d.choix.concepts[0].nom} » ?`;
  return r;
}

export function echoMusical(d: Pick<Donnees, 'precedente' | 'plan'>): string {
  const p = d.precedente;
  if (!p?.motif || !d.plan?.elements.length) return '';
  const e = d.plan.elements[0];
  if (e.uri !== p.motif.uri) return '';
  return `« ${e.nom} » (${e.auteur}) fermait la course ${num3(p.numero)} et ouvre celle-ci.`;
}

export function passage(c: Choix): string {
  return c.passage <= 1 ? 'premier passage' : `passage n° ${c.passage} (${c.raison})`;
}

export function source(d: Pick<Donnees, 'marche' | 'lu_le'>): string {
  return `Source des titres, durées et liens : API Web Spotify, marché ${d.marche}, lue le ${fmtHeure.format(d.lu_le)}. Contenu Spotify.`;
}

/** Un concept des courses n−1, n−3 et n−7 (répétition espacée). */
export function rappels(h: Historique, numero: number): Rappel[] {
  const out: Rappel[] = [];
  for (const k of [1, 3, 7]) {
    const c = ilYa(h, k);
    if (!c || !c.concepts?.length) continue;
    const i = numero % c.concepts.length;
    out.push({ course: c.numero, titre: c.theme_titre, concept: c.concepts[i], definition: c.definitions?.[i] ?? '' });
  }
  return out;
}

export function concepts(c: Concept[]): { noms: string[]; defs: string[] } {
  return { noms: c.map((x) => x.nom), defs: c.map((x) => x.definition) };
}

/** Fiche en Markdown simple (copie, partage, archivage). */
export function texte(d: Donnees): string {
  const L: string[] = [];
  if (d.apercu) L.push('> APERÇU — playlist non créée.', '');
  L.push(`# Course ${num3(d.numero)} — ${d.choix.theme.titre} — ${dateFr(d.date)}`, '');
  L.push(`Thème : ${d.choix.theme.titre} (${d.choix.theme.famille}, ${passage(d.choix)})`, '');
  L.push('## Paradoxe', d.choix.theme.paradoxe, '');
  L.push('## Trois concepts à retenir');
  d.choix.concepts.forEach((c, i) => L.push(`${i + 1}. ${c.nom} — ${c.definition}`));
  L.push('', '## Question pendant la course', d.choix.question, '');
  const p = pont(d);
  L.push('## Lien avec la course précédente', p.texte + (p.liaison ? ` Question de liaison : ${p.liaison}` : ''));
  const e = echoMusical(d);
  if (e) L.push(`Écho musical : ${e}`);
  if (d.rappels.length) {
    L.push('', '## Rappels espacés (répondre sans regarder)');
    for (const r of d.rappels) L.push(`- Course ${num3(r.course)} (${r.titre}) : que recouvre « ${r.concept} » ?`);
  }
  L.push('', '## Programme');
  for (const x of d.plan.elements) {
    let l = `${horloge(x.debut_ms)}  ${x.libelle} — ${x.nom} — ${x.auteur || '—'} (${duree(x.duree_ms)})`;
    if (x.type === 'episode' && x.date_sortie) l += `, diffusé le ${x.date_sortie}`;
    if (x.note) l += ` [${x.note}]`;
    if (x.url) l += `\n       ${x.url}`;
    L.push(l);
  }
  if (d.plan.blocs_vides.length) L.push('', `Blocs sans épisode adapté (remplacés par de la musique) : ${d.plan.blocs_vides.join(', ')}`);
  L.push('', `Durée totale ${d.total_relu ? 'relue dans la playlist créée' : 'prévue'} : ${duree(d.total_ms)} (${d.plan.elements.length} éléments).`);
  if (d.playlist_url) L.push(`Playlist : ${d.playlist_url}`);
  if (d.rappels.length) {
    L.push('', '## Réponses des rappels');
    for (const r of d.rappels) L.push(`- ${r.concept} : ${r.definition}`);
  }
  L.push('', source(d));
  return L.join('\n') + '\n';
}
