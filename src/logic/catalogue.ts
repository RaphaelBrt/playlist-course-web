// Collecte dans l'API : émissions, épisodes candidats, morceaux, relectures.
// Portage de internal/app/catalogue.go.
import type { Candidat } from './assemblage';
import type { Bloc, Config, Morceau, Theme } from './config';
import { contient, normaliser } from './texte';
import { type Client, type Episode, type Morceau as MorceauAPI, ErreurAPI, episodeJouable, morceauJouable } from './spotify';

export interface Cache {
  emissions: Record<string, { id: string; nom: string; absente: boolean; lu: number }>;
  morceaux: Record<string, { candidat?: Candidat; absent: boolean; lu: number }>;
}
export const cacheVide = (): Cache => ({ emissions: {}, morceaux: {} });
const JOUR = 86_400_000;
const DUREE_CACHE_EMISSION = 30 * JOUR;
const DUREE_CACHE_MORCEAU = 7 * JOUR;

export interface EmissionResolue { nom: string; bloc: string; langue: string; id: string; nomAPI: string; trouvee: boolean }

/** Âge d'un épisode en jours ; -1 si la date n'est pas au jour près. */
export function ageJours(date: string, precision: string, now: Date): number {
  if (precision && precision !== 'day') return -1;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!m) return -1;
  const t = new Date(+m[1], +m[2] - 1, +m[3]);
  if (t.getMonth() !== +m[2] - 1) return -1;
  const j = Math.trunc((now.getTime() - t.getTime()) / JOUR);
  return j < 0 ? 0 : j;
}

export function langueOK(langues: string[] | undefined, permises: string[]): boolean {
  if (!permises.length) return true;
  return (langues ?? []).some((l) => permises.includes(l.toLowerCase().split('-')[0]));
}

export function pertinence(e: Pick<Episode, 'name' | 'description'>, mots: string[]): number {
  let n = 0;
  for (const m of mots) {
    if (contient(e.name, m)) n += 2;
    else if (contient(e.description ?? '', m)) n += 1;
  }
  return n;
}

/** Règles de lisibilité « zéro erreur ». */
export function filtrerEpisode(e: Episode | null | undefined, langues: string[], deja: Set<string>): [boolean, string] {
  if (!e) return [false, 'élément vide'];
  if (!episodeJouable(e)) return [false, 'non jouable sur le marché'];
  if (!langueOK(e.languages, langues)) return [false, 'langue hors profil'];
  if (deja.has(e.uri)) return [false, 'déjà diffusé dans une course précédente'];
  return [true, ''];
}

const MOTS_PARASITES = ['karaoke', 'karaoké', 'tribute', 'cover', 'originally performed', 'made famous', 'instrumental version', '8 bit', 'lullaby', 'berceuse'];

export function scoreMorceau(t: MorceauAPI, m: Morceau): number {
  const artisteOK = t.artists.some((a) => normaliser(a.name) === normaliser(m.artiste) || contient(a.name, m.artiste) || contient(m.artiste, a.name));
  if (!artisteOK) return 0;
  const nt = normaliser(t.name), nm = normaliser(m.titre);
  for (const p of MOTS_PARASITES) {
    const np = normaliser(p);
    if (nt.includes(np) && !nm.includes(np)) return 0;
  }
  if (nt === nm) return 4;
  if (nt.startsWith(nm + ' ')) return 3;
  if (contient(t.name, m.titre)) return 2;
  return 0;
}

/** Tri stable par score décroissant. */
export function trier(c: Candidat[]): Candidat[] {
  return c.map((x, i) => [x, i] as const).sort((a, b) => b[0].score - a[0].score || a[1] - b[1]).map(([x]) => x);
}

const candidatMorceau = (t: MorceauAPI): Candidat => ({
  type: 'track', uri: t.uri, id: t.id, nom: t.name, auteur: t.artists.map((a) => a.name).join(', '),
  duree_ms: t.duration_ms, url: t.external_urls?.spotify ?? '', age_jours: -1, score: 0,
});

export class Catalogue {
  constructor(public api: Client, public cache: Cache, public cfg: Config, public now: Date, public journal: (m: string) => void = () => {}) {}

  /** Retrouve chaque émission du profil par /search (type=show), nom normalisé identique. */
  async resoudreEmissions(): Promise<EmissionResolue[]> {
    const out: EmissionResolue[] = [];
    for (const e of this.cfg.emissions) {
      const r: EmissionResolue = { nom: e.nom, bloc: e.bloc, langue: e.langue, id: '', nomAPI: '', trouvee: false };
      const cle = normaliser(e.nom);
      const c = this.cache.emissions[cle];
      if (c && this.now.getTime() - c.lu < DUREE_CACHE_EMISSION) {
        Object.assign(r, { id: c.id, nomAPI: c.nom, trouvee: !c.absente });
        out.push(r); continue;
      }
      const res = await this.api.rechercher(e.nom, ['show'], 10);
      const s = (res.shows?.items ?? []).find((s) => s && normaliser(s.name) === cle);
      if (s) Object.assign(r, { id: s.id, nomAPI: s.name, trouvee: true });
      this.cache.emissions[cle] = { id: r.id, nom: r.nomAPI, absente: !r.trouvee, lu: this.now.getTime() };
      if (!r.trouvee) this.journal(`Émission introuvable sur Spotify (marché ${this.cfg.marche}) : ${e.nom}`);
      out.push(r);
    }
    return out;
  }

  /** Épisodes des émissions de confiance, puis recherche par mots-clés du thème. */
  async episodesCandidats(bloc: Bloc, theme: Theme, emissions: EmissionResolue[], deja: Set<string>): Promise<Candidat[]> {
    const mots = theme.mots_cles[bloc.id] ?? [];
    const vus = new Set<string>();
    const principaux: Candidat[] = [], repli: Candidat[] = [];
    const ajouter = (e: Episode | null, auteur: string, confiance: boolean) => {
      if (!filtrerEpisode(e, this.cfg.langues, deja)[0] || !e || vus.has(e.uri)) return;
      vus.add(e.uri);
      const age = ageJours(e.release_date, e.release_date_precision, this.now);
      const c: Candidat = { type: 'episode', uri: e.uri, id: e.id, nom: e.name, auteur, duree_ms: e.duration_ms,
        url: e.external_urls?.spotify ?? '', date_sortie: e.release_date, age_jours: age, score: pertinence(e, mots) * 10 };
      if (confiance) c.score += 20;
      else c.note = 'hors liste d’émissions (recherche par mot-clé)';
      if (bloc.fraicheur_jours > 0) {
        if (age >= 0 && age <= bloc.fraicheur_jours) { c.score += bloc.fraicheur_jours - age; principaux.push(c); }
        else if (age >= 0 && age <= bloc.fraicheur_repli_jours) {
          c.note = [c.note, `plus de ${bloc.fraicheur_jours} jours`].filter(Boolean).join(' ; ');
          repli.push(c);
        }
        return;
      }
      principaux.push(c);
    };
    const limite = bloc.fraicheur_jours > 0 ? 20 : 50;
    for (const em of emissions) {
      if (!em.trouvee || em.bloc !== bloc.id) continue;
      let eps: (Episode | null)[];
      try { eps = await this.api.episodesEmission(em.id, limite); }
      catch (err) {
        if (err instanceof ErreurAPI && err.status === 404) { this.journal(`Émission indisponible : ${em.nom}`); continue; }
        throw err;
      }
      for (const e of eps) ajouter(e, em.nomAPI, true);
    }
    if (this.cfg.recherche_ouverte) {
      for (const m of mots) {
        const res = await this.api.rechercher(m, ['episode'], 10);
        for (const e of res.episodes?.items ?? []) ajouter(e, '', false);
      }
    }
    return [...trier(principaux), ...trier(repli)];
  }

  async resoudreMorceau(m: Morceau): Promise<Candidat | null> {
    const c = await this.resoudre(m);
    return c ? { ...c, note: m.pourquoi } : null; // la note dépend du thème, pas du cache
  }

  private async resoudre(m: Morceau): Promise<Candidat | null> {
    const cle = normaliser(m.artiste) + '|' + normaliser(m.titre);
    const c = this.cache.morceaux[cle];
    if (c && this.now.getTime() - c.lu < DUREE_CACHE_MORCEAU) return c.absent || !c.candidat ? null : { ...c.candidat };
    // 1. Identifiant noté dans la fiche source : relu dans l'API (jouable, marché).
    if (m.spotify_id) {
      const v = await this.verifierMorceau(m.spotify_id);
      if (v) { this.cache.morceaux[cle] = { candidat: v, absent: false, lu: this.now.getTime() }; return { ...v }; }
      this.journal(`Identifiant de fiche non jouable (marché ${this.cfg.marche}), recherche par titre : ${m.artiste} — ${m.titre}`);
    }
    // 2. Recherche avec filtres de champ, puis requête libre.
    let meilleur: MorceauAPI | null = null, ms = 0;
    for (const q of [`track:${m.titre} artist:${m.artiste}`, `${m.titre} ${m.artiste}`]) {
      const res = await this.api.rechercher(q, ['track'], 10);
      for (const t of res.tracks?.items ?? []) {
        if (!morceauJouable(t)) continue;
        const s = scoreMorceau(t, m);
        if (s > ms) { ms = s; meilleur = t; }
      }
      if (meilleur) break;
    }
    if (!meilleur) {
      this.cache.morceaux[cle] = { absent: true, lu: this.now.getTime() };
      this.journal(`Morceau introuvable ou non jouable : ${m.artiste} — ${m.titre}`);
      return null;
    }
    const cand = candidatMorceau(meilleur);
    this.cache.morceaux[cle] = { candidat: cand, absent: false, lu: this.now.getTime() };
    return { ...cand };
  }

  /** Relit GET /episodes/{id} : jouable, émission non exclue, nom de l'émission. */
  async verifierEpisode(c: Candidat): Promise<[boolean, string]> {
    let e: Episode;
    try { e = await this.api.episode(c.id); }
    catch (err) {
      if (err instanceof ErreurAPI && (err.status === 404 || err.status === 400)) return [false, 'épisode introuvable'];
      throw err;
    }
    if (!episodeJouable(e)) return [false, 'épisode non jouable sur le marché'];
    if (e.show) {
      if (this.cfg.emissions_exclues.some((x) => normaliser(x) === normaliser(e.show!.name))) return [false, 'émission exclue par le profil'];
      c.auteur = e.show.name;
    }
    c.duree_ms = e.duration_ms;
    return [true, ''];
  }

  /** Relit GET /tracks/{id} (écho, identifiants des fiches). */
  async verifierMorceau(id: string): Promise<Candidat | null> {
    let t: MorceauAPI;
    try { t = await this.api.morceau(id); }
    catch (err) {
      if (err instanceof ErreurAPI && (err.status === 404 || err.status === 400)) return null;
      throw err;
    }
    return morceauJouable(t) ? candidatMorceau(t) : null;
  }
}
