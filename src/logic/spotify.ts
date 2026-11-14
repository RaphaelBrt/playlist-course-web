// Client minimal de l'API Web Spotify, portage de internal/spotify.
// Points d'accès encore ouverts en mode développement (changements de février 2026) :
// /search (limite 10), /shows/{id}/episodes, /episodes/{id}, /tracks/{id},
// POST /me/playlists, /playlists/{id}/items.
export const API_BASE = 'https://api.spotify.com/v1';
export const COMPTES_BASE = 'https://accounts.spotify.com';

export interface Restrictions { reason: string }
export interface Artiste { id: string; name: string; uri: string }
export interface Morceau {
  id: string; name: string; uri: string; type: string; duration_ms: number;
  is_local?: boolean; is_playable?: boolean; restrictions?: Restrictions | null;
  artists: Artiste[]; external_urls: { spotify: string }; linked_from?: { uri: string } | null;
}
export interface Emission { id: string; name: string; uri: string; languages?: string[]; external_urls?: { spotify: string } }
export interface Episode {
  id: string; name: string; uri: string; type: string; description: string; duration_ms: number;
  is_externally_hosted?: boolean; is_playable?: boolean; languages?: string[];
  release_date: string; release_date_precision: string; restrictions?: Restrictions | null;
  external_urls: { spotify: string }; show?: Emission | null;
}
export interface Page<T> { items: T[]; next: string | null; total?: number; limit?: number; offset?: number }
export interface ReponseRecherche { tracks?: Page<Morceau | null>; shows?: Page<Emission | null>; episodes?: Page<Episode | null> }
export interface Playlist { id: string; name: string; uri: string; snapshot_id?: string; external_urls: { spotify: string } }
export interface ElementPlaylist { added_at?: string; is_local?: boolean; item?: unknown; track?: unknown }

/** Règle « zéro erreur » : is_playable présent et vrai (il l'est avec un marché), sans restriction. */
export function jouable(isPlayable: boolean | undefined | null, r: Restrictions | null | undefined): boolean {
  return isPlayable === true && !r;
}
export function morceauJouable(t: Morceau | null | undefined): t is Morceau {
  return !!t && !t.is_local && !!t.uri && t.duration_ms > 0 && jouable(t.is_playable, t.restrictions);
}
export function episodeJouable(e: Episode | null | undefined): e is Episode {
  return !!e && !e.is_externally_hosted && !!e.uri && e.duration_ms > 0 && jouable(e.is_playable, e.restrictions);
}

export interface ElementRelu {
  type: string; uri: string; uriLiee: string; nom: string; duree_ms: number;
  is_playable?: boolean; restrictions?: Restrictions | null; externe: boolean; vide: boolean;
}

/** Lit un élément de playlist : « item » remplace « track » (février 2026) ; les deux sont lus. */
export function decoderElement(p: ElementPlaylist): ElementRelu {
  let raw = p.item;
  if (raw == null) raw = p.track;
  if (raw == null || typeof raw !== 'object') return { type: '', uri: '', uriLiee: '', nom: '', duree_ms: 0, externe: false, vide: true };
  const e = raw as Record<string, any>;
  return {
    type: e.type ?? '', uri: e.uri ?? '', uriLiee: e.linked_from?.uri ?? '', nom: e.name ?? '',
    duree_ms: e.duration_ms ?? 0, is_playable: e.is_playable, restrictions: e.restrictions,
    externe: !!e.is_externally_hosted, vide: false,
  };
}

export class ErreurAPI extends Error {
  constructor(public status: number, public detail = '', public raison = '') {
    super(ErreurAPI.texte(status, detail, raison));
  }
  static texte(status: number, detail: string, raison: string): string {
    let m = `API Spotify : HTTP ${status}`;
    if (detail) m += ` — ${detail}`;
    if (raison) m += ` (${raison})`;
    if (status === 401) m += '. Jeton refusé : reconnectez-vous dans Réglages.';
    if (status === 403) m += ". Accès refusé : vérifiez que votre compte figure dans « User Management » de l'application Spotify et que son propriétaire a Spotify Premium.";
    if (status === 429) m += '. Limite de débit atteinte : réessayez plus tard.';
    return m;
  }
}

export class ErreurReseau extends Error {
  constructor() { super('Réseau indisponible : vérifiez la connexion, puis réessayez.'); }
}

export interface SourceJeton { jeton(): Promise<string>; invalider(): void }
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class Client {
  appels = 0;
  maxAttenteRetry = 30_000;
  constructor(
    public jetons: SourceJeton,
    public marche: string,
    public fetcher: Fetch = (i, o) => fetch(i, o),
    public base = API_BASE,
    public dormir: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async faire<T>(methode: string, chemin: string, q: Record<string, string> | null, corps?: unknown): Promise<T> {
    let u = this.base.replace(/\/+$/, '') + chemin;
    if (q && Object.keys(q).length) u += '?' + new URLSearchParams(q).toString();
    let essaiAuth = false;
    for (let tentative = 0; ; tentative++) {
      const jeton = await this.jetons.jeton();
      const headers: Record<string, string> = { Authorization: 'Bearer ' + jeton };
      if (corps !== undefined) headers['Content-Type'] = 'application/json';
      this.appels++;
      let resp: Response;
      try {
        resp = await this.fetcher(u, { method: methode, headers, body: corps !== undefined ? JSON.stringify(corps) : undefined });
      } catch {
        throw new ErreurReseau();
      }
      const texte = await resp.text();
      if (resp.ok) {
        if (!texte) return undefined as T;
        try { return JSON.parse(texte) as T; } catch { throw new Error(`Réponse illisible de ${chemin}.`); }
      }
      const e = lireErreur(resp.status, texte);
      if (resp.status === 401 && !essaiAuth) { essaiAuth = true; this.jetons.invalider(); continue; }
      if (resp.status === 429 && e.raison !== 'QUOTA_EXCEEDED' && tentative < 2) {
        const s = parseInt(resp.headers.get('Retry-After') ?? '', 10);
        const attente = Number.isFinite(s) ? s * 1000 : 2000;
        if (attente <= this.maxAttenteRetry) { await this.dormir(attente); continue; }
      }
      if (resp.status >= 500 && tentative < 1) { await this.dormir(1000); continue; }
      throw e;
    }
  }

  private avecMarche(q: Record<string, string> = {}): Record<string, string> {
    if (this.marche) q.market = this.marche;
    return q;
  }

  rechercher(requete: string, types: string[], limite = 10): Promise<ReponseRecherche> {
    if (limite < 1 || limite > 10) limite = 10;
    return this.faire('GET', '/search', this.avecMarche({ q: requete, type: types.join(','), limit: String(limite) }));
  }
  async episodesEmission(id: string, limite = 50): Promise<(Episode | null)[]> {
    if (limite < 1 || limite > 50) limite = 50;
    const p = await this.faire<Page<Episode | null>>('GET', `/shows/${encodeURIComponent(id)}/episodes`, this.avecMarche({ limit: String(limite) }));
    return p?.items ?? [];
  }
  episode(id: string): Promise<Episode> {
    return this.faire('GET', `/episodes/${encodeURIComponent(id)}`, this.avecMarche());
  }
  morceau(id: string): Promise<Morceau> {
    return this.faire('GET', `/tracks/${encodeURIComponent(id)}`, this.avecMarche());
  }
  async creerPlaylist(nom: string, description: string, publique: boolean): Promise<Playlist> {
    const p = await this.faire<Playlist>('POST', '/me/playlists', null, { name: nom, description, public: publique });
    if (!p?.id) throw new Error('Création de playlist : identifiant absent de la réponse.');
    return p;
  }
  async ajouterElements(id: string, uris: string[]): Promise<void> {
    for (let i = 0; i < uris.length; i += 100)
      await this.faire('POST', `/playlists/${encodeURIComponent(id)}/items`, null, { uris: uris.slice(i, i + 100) });
  }
  async elementsPlaylist(id: string): Promise<ElementPlaylist[]> {
    const tous: ElementPlaylist[] = [];
    for (let offset = 0; ; offset += 50) {
      const p = await this.faire<Page<ElementPlaylist>>('GET', `/playlists/${encodeURIComponent(id)}/items`,
        this.avecMarche({ limit: '50', offset: String(offset), additional_types: 'track,episode' }));
      tous.push(...(p?.items ?? []));
      if (!p?.next || !p.items?.length) return tous;
      if (offset > 1000) throw new Error('Relecture : trop d’éléments.');
    }
  }
}

function lireErreur(status: number, texte: string): ErreurAPI {
  let detail = '', raison = '';
  try {
    const v = JSON.parse(texte);
    if (v && typeof v.error === 'object' && v.error) { detail = v.error.message ?? ''; raison = v.error.reason ?? ''; }
    detail ||= v?.message ?? (typeof v?.error_description === 'string' ? v.error_description : '');
    raison ||= v?.reason ?? '';
  } catch { /* corps non JSON */ }
  return new ErreurAPI(status, detail, raison);
}
