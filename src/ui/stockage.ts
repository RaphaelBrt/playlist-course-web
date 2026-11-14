// Tout reste sur l'appareil (localStorage) : Client ID, jeton, historique, cache, fiche.
import type { Coffre, Jeton } from '../logic/auth';
import { type Cache, cacheVide } from '../logic/catalogue';
import type { Donnees } from '../logic/fiche';
import { type Historique, historiqueVide } from '../logic/historique';

const lire = <T>(k: string, def: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : def; } catch { return def; } };
const ecrire = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));

export const stock = {
  clientId: (): string => lire<string>('pc.clientId', '') || ((window as any).PLAYLIST_COURSE_CONFIG?.clientId ?? ''),
  setClientId: (v: string) => ecrire('pc.clientId', v.trim()),
  historique: (): Historique => lire('pc.historique', historiqueVide()),
  setHistorique: (h: Historique) => ecrire('pc.historique', h),
  cache: (): Cache => lire('pc.cache', cacheVide()),
  setCache: (c: Cache) => ecrire('pc.cache', c),
  fiche: (): Donnees | null => {
    const d = lire<any>('pc.fiche', null);
    if (!d) return null;
    d.date = new Date(d.date); d.lu_le = new Date(d.lu_le);
    return d;
  },
  setFiche: (d: Donnees | null) => d ? ecrire('pc.fiche', d) : localStorage.removeItem('pc.fiche'),
  pkce: (): { verificateur: string; etat: string; redirection: string } | null => lire('pc.pkce', null),
  setPkce: (v: { verificateur: string; etat: string; redirection: string } | null) => v ? ecrire('pc.pkce', v) : localStorage.removeItem('pc.pkce'),
};

export const coffre: Coffre = {
  lire: () => lire<Jeton | null>('pc.jeton', null),
  ecrire: (j) => ecrire('pc.jeton', j),
  effacer: () => localStorage.removeItem('pc.jeton'),
};
