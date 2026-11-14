// Faux Spotify en mémoire (données SIMULÉES) : mêmes formes JSON que l'API Web.
import { createHash } from 'node:crypto';
import type { Config } from '../../src/logic/config';
import { normaliser } from '../../src/logic/texte';
import { mulberry32 } from '../../src/logic/hasard';

export interface Reponse { status: number; body: unknown; headers?: Record<string, string> }

export function fauxSpotify(cfg: Config, maintenant: Date) {
  const r = mulberry32(42);
  const tracks: any[] = [], shows: any[] = [], episodes = new Map<string, any>();
  const playlists = new Map<string, string[]>();
  const defis = new Map<string, string>();
  const requetes: string[] = [];
  let n = 0;
  const id = (p: string) => `${p}${(++n).toString(36).padStart(6, '0')}`;
  const morceaux = [...cfg.musique_generale, ...cfg.themes.flatMap((t) => t.musique)];
  const vus = new Set<string>();
  for (const m of morceaux) {
    const cle = normaliser(m.artiste + '|' + m.titre);
    if (vus.has(cle)) continue; vus.add(cle);
    const i = m.spotify_id || id('t');
    tracks.push({ id: i, name: m.titre, uri: `spotify:track:${i}`, type: 'track', duration_ms: 150000 + Math.floor(r() * 180000),
      is_playable: true, is_local: false, artists: [{ id: 'a' + i, name: m.artiste, uri: '' }], external_urls: { spotify: `https://open.spotify.com/track/${i}` } });
  }
  const jour = (k: number) => { const d = new Date(maintenant.getTime() - k * 86400000); return d.toISOString().slice(0, 10); };
  for (const e of cfg.emissions) {
    const sid = id('s');
    const eps = Array.from({ length: 12 }, (_, k) => {
      const eid = id('e');
      const ep = { id: eid, name: `${e.nom} — épisode SIMULÉ ${k + 1}`, uri: `spotify:episode:${eid}`, type: 'episode',
        description: 'Épisode simulé pour les tests.', duration_ms: (4 + Math.floor(r() * 18)) * 60000 + Math.floor(r() * 59000),
        is_playable: true, is_externally_hosted: false, languages: [e.langue], release_date: jour(k * 6 + 1), release_date_precision: 'day',
        external_urls: { spotify: `https://open.spotify.com/episode/${eid}` }, show: { id: sid, name: e.nom, uri: `spotify:show:${sid}` } };
      episodes.set(eid, ep); return ep;
    });
    shows.push({ id: sid, name: e.nom, uri: `spotify:show:${sid}`, languages: [e.langue], eps });
  }
  const page = (items: unknown[]) => ({ items, next: null, total: items.length });
  const sansShow = ({ show, ...e }: any) => e;

  function traiter(methode: string, url: string, headers: Record<string, string>, corps: string): Reponse {
    const u = new URL(url);
    requetes.push(`${methode} ${u.host}${u.pathname}`);
    if (u.host === 'accounts.spotify.com' && u.pathname === '/api/token') {
      const f = new URLSearchParams(corps);
      if (f.get('grant_type') === 'authorization_code') {
        const defi = defis.get(f.get('code') ?? '');
        const calc = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url');
        if (!defi || defi !== calc) return { status: 400, body: { error: 'invalid_grant', error_description: 'code_verifier incorrect' } };
      }
      return { status: 200, body: { access_token: 'jeton-test', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rafraichissement-test', scope: f.get('scope') ?? '' } };
    }
    if (headers['authorization'] !== 'Bearer jeton-test') return { status: 401, body: { error: { status: 401, message: 'Invalid access token' } } };
    const q = u.searchParams, p = u.pathname.replace('/v1', '').split('/').filter(Boolean);
    if (methode === 'GET' && p[0] === 'search') {
      const t = q.get('type'), txt = normaliser(q.get('q') ?? '');
      if (t === 'show') return { status: 200, body: { shows: page(shows.filter((s) => txt.includes(normaliser(s.name))).map(({ eps, ...s }) => s)) } };
      if (t === 'track') return { status: 200, body: { tracks: page(tracks.filter((x) => txt.includes(normaliser(x.name)) && txt.includes(normaliser(x.artists[0].name))).slice(0, 10)) } };
      if (t === 'episode') return { status: 200, body: { episodes: page([null]) } };
    }
    if (methode === 'GET' && p[0] === 'shows') {
      const s = shows.find((s) => s.id === p[1]);
      return s ? { status: 200, body: page(s.eps.slice(0, +(q.get('limit') ?? 50)).map(sansShow)) } : { status: 404, body: { error: { status: 404, message: 'Not found' } } };
    }
    if (methode === 'GET' && p[0] === 'episodes') { const e = episodes.get(p[1]); return e ? { status: 200, body: e } : { status: 404, body: {} }; }
    if (methode === 'GET' && p[0] === 'tracks') { const t = tracks.find((t) => t.id === p[1]); return t ? { status: 200, body: t } : { status: 404, body: {} }; }
    if (methode === 'POST' && p[0] === 'me' && p[1] === 'playlists') {
      const pid = id('p'); playlists.set(pid, []);
      const b = JSON.parse(corps);
      return { status: 201, body: { id: pid, name: b.name, uri: `spotify:playlist:${pid}`, external_urls: { spotify: `https://open.spotify.com/playlist/${pid}` } } };
    }
    if (p[0] === 'playlists' && p[2] === 'items') {
      const l = playlists.get(p[1]);
      if (!l) return { status: 404, body: {} };
      if (methode === 'POST') { l.push(...JSON.parse(corps).uris); return { status: 201, body: { snapshot_id: 'x' } }; }
      const off = +(q.get('offset') ?? 0), lim = +(q.get('limit') ?? 50);
      const items = l.slice(off, off + lim).map((uri) => {
        const [, type, i] = uri.split(':');
        return { item: type === 'track' ? tracks.find((t) => t.id === i) : episodes.get(i) };
      });
      return { status: 200, body: { items, next: off + lim < l.length ? 'suite' : null } };
    }
    return { status: 404, body: { error: { status: 404, message: 'Service invalid' } } };
  }
  return { traiter, defis, requetes, playlists };
}

/** fetch() branché sur le faux serveur, pour les tests unitaires. */
export function fetchFaux(f: ReturnType<typeof fauxSpotify>) {
  return async (url: string, init: RequestInit = {}) => {
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers as Record<string, string>) ?? {})) h[k.toLowerCase()] = v;
    const r = f.traiter(init.method ?? 'GET', url, h, (init.body as string) ?? '');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
}
