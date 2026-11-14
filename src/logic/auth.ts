// Échange et rafraîchissement du jeton (PKCE, sans secret), portage de internal/spotify/auth.go.
import { COMPTES_BASE, type Fetch, type SourceJeton } from './spotify';

export interface Jeton {
  access_token: string; refresh_token: string; scope: string; token_type: string;
  expiration: number; // epoch ms
  client_id: string; obtenu: number;
}

export interface Coffre { lire(): Jeton | null; ecrire(j: Jeton): void; effacer(): void }

export class ErreurJeton extends Error {
  constructor(public status: number, public code: string, desc: string) {
    super(`Spotify a refusé le jeton (HTTP ${status}${code ? ', ' + code : ''}${desc ? ' : ' + desc : ''}).`);
  }
}

async function appelJeton(fetcher: Fetch, base: string, form: Record<string, string>): Promise<Record<string, any>> {
  let resp: Response;
  try {
    resp = await fetcher(base.replace(/\/+$/, '') + '/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new Error('Réseau indisponible pendant la connexion à Spotify.');
  }
  let r: Record<string, any> = {};
  try { r = await resp.json(); } catch { /* corps vide */ }
  if (resp.status !== 200 || !r.access_token) throw new ErreurJeton(resp.status, r.error ?? '', r.error_description ?? '');
  return r;
}

export async function echanger(fetcher: Fetch, clientId: string, code: string, redirection: string, verificateur: string, now = Date.now(), base = COMPTES_BASE): Promise<Jeton> {
  const r = await appelJeton(fetcher, base, {
    grant_type: 'authorization_code', code, redirect_uri: redirection, client_id: clientId, code_verifier: verificateur,
  });
  return { access_token: r.access_token, refresh_token: r.refresh_token ?? '', scope: r.scope ?? '', token_type: r.token_type ?? 'Bearer',
    expiration: now + (r.expires_in ?? 3600) * 1000, client_id: clientId, obtenu: now };
}

export async function rafraichir(fetcher: Fetch, j: Jeton, now = Date.now(), base = COMPTES_BASE): Promise<Jeton> {
  const r = await appelJeton(fetcher, base, { grant_type: 'refresh_token', refresh_token: j.refresh_token, client_id: j.client_id });
  // Spotify peut renouveler le refresh token ; sinon l'ancien reste valable.
  return { ...j, access_token: r.access_token, refresh_token: r.refresh_token || j.refresh_token, scope: r.scope ?? j.scope,
    expiration: now + (r.expires_in ?? 3600) * 1000 };
}

/** Fournit un jeton valide, rafraîchi 60 s avant expiration ou après un 401. */
export class Session implements SourceJeton {
  private invalide = false;
  private enCours: Promise<Jeton> | null = null;
  constructor(private coffre: Coffre, private fetcher: Fetch, private maintenant = () => Date.now(), private base = COMPTES_BASE) {}
  invalider() { this.invalide = true; }
  async jeton(): Promise<string> {
    const j = this.coffre.lire();
    if (!j) throw new Error('Non connecté à Spotify : connectez-vous dans Réglages.');
    if (!this.invalide && this.maintenant() < j.expiration - 60_000) return j.access_token;
    if (!j.refresh_token) throw new Error('Session expirée : reconnectez-vous dans Réglages.');
    this.enCours ??= rafraichir(this.fetcher, j, this.maintenant(), this.base).finally(() => { this.enCours = null; });
    try {
      const n = await this.enCours;
      this.coffre.ecrire(n);
      this.invalide = false;
      return n.access_token;
    } catch (e) {
      if (e instanceof ErreurJeton && (e.code === 'invalid_grant' || e.status === 400)) {
        this.coffre.effacer();
        throw new Error('Autorisation Spotify expirée ou retirée : reconnectez-vous dans Réglages.');
      }
      throw e;
    }
  }
}
