// Enchaînement d'une course : préparation (aperçu vérifié) puis création et relecture.
// Portage de internal/app/run.go.
import { type BlocParle, type Candidat, type Plan, ErreurAjustement, assembler } from './assemblage';
import { type Cache, Catalogue } from './catalogue';
import type { Config } from './config';
import { type Donnees, concepts, description, nomPlaylist, rappels } from './fiche';
import { melanger } from './hasard';
import { type Course, type ElementHisto, type Historique, dejaJoues, derniere } from './historique';
import { type Client, type ElementPlaylist, decoderElement, jouable } from './spotify';
import { choisirTheme } from './theme';

export interface Preparation extends Donnees { journal: string[] }

export async function preparer(cfg: Config, h: Historique, api: Client, cache: Cache, now: Date, force = '', log: (m: string) => void = () => {}): Promise<Preparation> {
  const journal: string[] = [];
  const j = (m: string) => { journal.push(m); log(m); };
  const d = derniere(h);
  let numero = h.courses.length + 1;
  if (d && d.numero >= numero) numero = d.numero + 1;
  const choix = choisirTheme(cfg, h, force);
  j(`Course ${numero} : thème « ${choix.theme.titre} » (${choix.raison}).`);
  const k = new Catalogue(api, cache, cfg, now, j);
  const emissions = await k.resoudreEmissions();
  const { episodes: dejaEp, morceaux: dejaM } = dejaJoues(h, 3);
  const episodes: Record<string, Candidat[]> = {};
  const blocs: BlocParle[] = [];
  for (const b of cfg.structure.blocs_parles) {
    episodes[b.id] = await k.episodesCandidats(b, choix.theme, emissions, dejaEp);
    blocs.push({ id: b.id, libelle: b.libelle, min_ms: b.duree_min_min * 60000, max_ms: b.duree_max_min * 60000 });
  }
  let echo: Candidat | null = null;
  if (d?.motif) {
    echo = await k.verifierMorceau(d.motif.uri.replace('spotify:track:', ''));
    if (echo) dejaM.delete(echo.uri); else j(`Écho musical non rejouable : ${d.motif.nom}`);
  }
  const theme: Candidat[] = [];
  for (const m of choix.theme.musique) {
    const c = await k.resoudreMorceau(m);
    if (c && !dejaM.has(c.uri)) theme.push({ ...c, theme: true });
  }
  const ordre = melanger(cfg.musique_generale, `${numero}-${choix.theme.id}`);
  const fonds: Candidat[] = [];
  let iF = 0;
  const resoudreFonds = async (n: number) => {
    for (; iF < ordre.length && n > 0; iF++) {
      const c = await k.resoudreMorceau(ordre[iF]);
      if (c && !dejaM.has(c.uri)) { fonds.push(c); n--; }
    }
  };
  await resoudreFonds(8);
  const exclus = new Set<string>();
  const min = (cfg.duree_cible_min - cfg.tolerance_min) * 60000, max = (cfg.duree_cible_min + cfg.tolerance_min) * 60000;
  let plan: Plan | null = null;
  for (let essai = 0; essai < 12 && !plan; essai++) {
    let p: Plan;
    try {
      p = assembler({ cible_ms: cfg.duree_cible_min * 60000, tolerance_ms: cfg.tolerance_min * 60000,
        echauffement_ms: cfg.structure.echauffement_min_min * 60000, parole_max_ms: cfg.structure.parole_max_min * 60000,
        retour_calme_min_ms: cfg.structure.retour_au_calme_min_min * 60000, blocs, episodes, echo,
        morceaux_theme: theme, fonds, exclus, morceau_max_ms: (cfg.structure.morceau_max_min ?? 0) * 60000 });
    } catch (e) {
      if (e instanceof ErreurAjustement && iF < ordre.length) { await resoudreFonds(5); continue; }
      if (e instanceof ErreurAjustement) throw new Error(e.message + ' : ajoutez des morceaux à « musique_generale » dans le profil.');
      throw e;
    }
    // Relecture individuelle de chaque épisode retenu (GET /episodes/{id}).
    let refaire = false;
    for (const el of p.elements) {
      if (el.type !== 'episode') continue;
      const [ok, raison] = await k.verifierEpisode(el);
      if (!ok) { j(`Épisode écarté (${raison}) : ${el.nom}`); exclus.add(el.uri); refaire = true; continue; }
      for (const c of episodes[el.bloc] ?? []) if (c.uri === el.uri) c.auteur = el.auteur;
    }
    if (refaire) continue;
    let t = 0;
    for (const el of p.elements) { el.debut_ms = t; t += el.duree_ms; }
    p.total_ms = t;
    if (t >= min && t <= max) { plan = p; break; }
    j('Durées relues hors fenêtre : nouvel assemblage.');
    const dernierEp = [...p.elements].reverse().find((e) => e.type === 'episode');
    if (dernierEp) exclus.add(dernierEp.uri);
  }
  if (!plan) throw new Error('Aucun assemblage vérifié après plusieurs essais.');
  return { numero, date: now, choix, precedente: d, rappels: rappels(h, numero), plan, total_ms: plan.total_ms,
    total_relu: false, apercu: true, marche: cfg.marche, lu_le: now, journal };
}

/** Compare la playlist relue au plan : mêmes URI dans le même ordre, rien de vide, tout jouable. */
export function verifier(p: Plan, items: ElementPlaylist[]): { total: number; problemes: string[] } {
  const problemes: string[] = [];
  let total = 0;
  if (items.length !== p.elements.length) problemes.push(`${items.length} éléments relus pour ${p.elements.length} prévus`);
  items.forEach((it, i) => {
    const el = decoderElement(it);
    if (el.vide) { problemes.push(`élément ${i + 1} vide (contenu retiré ou indisponible)`); return; }
    total += el.duree_ms;
    const attendu = p.elements[i]?.uri;
    if (attendu && el.uri !== attendu && el.uriLiee !== attendu) problemes.push(`élément ${i + 1} : ${el.uri} relu au lieu de ${attendu}`);
    if (!jouable(el.is_playable, el.restrictions) || el.externe) problemes.push(`élément ${i + 1} non jouable : ${el.nom}`);
  });
  return { total, problemes };
}

/** Crée la playlist, la remplit, la relit et ajoute la course à l'historique. */
export async function creer(cfg: Config, h: Historique, api: Client, prep: Preparation): Promise<{ donnees: Donnees; course: Course }> {
  const pl = await api.creerPlaylist(nomPlaylist(prep), description(prep), cfg.playlist_publique);
  const url = pl.external_urls?.spotify ?? `https://open.spotify.com/playlist/${pl.id}`;
  try { await api.ajouterElements(pl.id, prep.plan.elements.map((e) => e.uri)); }
  catch (e) { throw new Error(`Playlist créée (${url}) mais remplissage interrompu : ${(e as Error).message}`); }
  const items = await api.elementsPlaylist(pl.id);
  const { total, problemes } = verifier(prep.plan, items);
  const min = (cfg.duree_cible_min - cfg.tolerance_min) * 60000, max = (cfg.duree_cible_min + cfg.tolerance_min) * 60000;
  if (total < min || total > max) problemes.push(`durée relue hors de ${cfg.duree_cible_min} ± ${cfg.tolerance_min} min`);
  const donnees: Donnees = { ...prep, apercu: false, total_ms: total, total_relu: true, playlist_url: url, problemes };
  const { noms, defs } = concepts(prep.choix.concepts);
  const elements: ElementHisto[] = prep.plan.elements.map((e) => ({ uri: e.uri, type: e.type, nom: e.nom, auteur: e.auteur, duree_ms: e.duree_ms }));
  const course: Course = { numero: prep.numero, date: prep.date.toISOString(), theme_id: prep.choix.theme.id,
    theme_titre: prep.choix.theme.titre, paradoxe: prep.choix.theme.paradoxe, passage: prep.choix.passage,
    concepts: noms, definitions: defs, question: prep.choix.question, playlist_id: pl.id, playlist_url: url,
    duree_ms: total, elements, motif: [...elements].reverse().find((e) => e.type === 'track') ?? null };
  h.courses.push(course);
  return { donnees, course };
}
