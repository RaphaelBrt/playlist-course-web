// Flux Authorization Code + PKCE (RFC 7636), sans secret client.
export const PORTEES = 'playlist-modify-private playlist-modify-public playlist-read-private';

export function base64url(octets: Uint8Array): string {
  let bin = '';
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** code_verifier : 64 octets aléatoires en base64url, soit 86 caractères de [A-Za-z0-9-_]. */
export function nouveauVerificateur(): string {
  const b = new Uint8Array(64);
  crypto.getRandomValues(b);
  return base64url(b);
}

/** code_challenge S256 : base64url(SHA-256(ASCII(verifier))). */
export async function defi(verificateur: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificateur));
  return base64url(new Uint8Array(h));
}

export function etatAleatoire(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return base64url(b);
}

export function urlAutorisation(base: string, clientId: string, redirection: string, etat: string, codeDefi: string): string {
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirection, state: etat,
    scope: PORTEES, code_challenge_method: 'S256', code_challenge: codeDefi,
  });
  return base.replace(/\/+$/, '') + '/authorize?' + q.toString();
}

/**
 * URI de redirection : l'adresse exacte de la page, sans requête ni fragment,
 * « index.html » retiré. Spotify exige HTTPS, sauf boucle locale 127.0.0.1 / [::1]
 * (« localhost » refusé).
 */
export function uriRedirection(loc: { origin: string; pathname: string }): string {
  let chemin = loc.pathname.replace(/index\.html$/, '');
  if (!chemin.endsWith('/')) chemin = chemin.replace(/[^/]*$/, '');
  return loc.origin + chemin;
}

export type DiagnosticRedirection = { ok: true } | { ok: false; raison: string };

export function verifierRedirection(uri: string): DiagnosticRedirection {
  let u: URL;
  try { u = new URL(uri); } catch { return { ok: false, raison: 'Adresse illisible.' }; }
  if (u.hostname === 'localhost')
    return { ok: false, raison: 'Spotify refuse « localhost ». Ouvrez la page par http://127.0.0.1:PORT/.' };
  if (u.protocol === 'https:') return { ok: true };
  if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === '[::1]')) return { ok: true };
  return { ok: false, raison: 'Spotify exige une adresse HTTPS (sauf 127.0.0.1 en local). Publiez la page sur un hébergement HTTPS.' };
}
