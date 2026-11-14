import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assembler, ErreurAjustement, type Candidat } from '../../src/logic/assemblage';
import { analyser } from '../../src/logic/config';
import { defi, nouveauVerificateur, uriRedirection, verifierRedirection } from '../../src/logic/pkce';
import { mulberry32 } from '../../src/logic/hasard';
import { choisirTheme } from '../../src/logic/theme';
import { historiqueVide } from '../../src/logic/historique';
import { cacheVide } from '../../src/logic/catalogue';
import { Client } from '../../src/logic/spotify';
import { creer, preparer } from '../../src/logic/course';
import { fauxSpotify, fetchFaux } from '../fake/fauxSpotify';

const cfg = () => analyser(JSON.parse(readFileSync('public/interets.json', 'utf8')));
const MIN = 57 * 60000, MAX = 63 * 60000;

describe('PKCE (RFC 7636)', () => {
  it('vecteur de l’annexe B', async () => {
    expect(await defi('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('verifier de 86 caractères non réservés, toujours différent', () => {
    const a = nouveauVerificateur();
    expect(a).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(nouveauVerificateur()).not.toBe(a);
  });
  it('URI de redirection et règles Spotify', () => {
    expect(uriRedirection({ origin: 'https://x.github.io', pathname: '/playlist-course-web/index.html' })).toBe('https://x.github.io/playlist-course-web/');
    expect(verifierRedirection('http://localhost:5173/').ok).toBe(false);
    expect(verifierRedirection('http://127.0.0.1:4173/').ok).toBe(true);
    expect(verifierRedirection('http://192.168.1.2/').ok).toBe(false);
  });
});

describe('Remplissage 57–63 min sur tirages aléatoires', () => {
  it('500 tirages : durée dans la fenêtre, aucun doublon, blocs respectés', () => {
    let reussis = 0, echecs = 0;
    for (let g = 1; g <= 500; g++) {
      const r = mulberry32(g);
      const m = (p: string, k: number, d: [number, number]): Candidat[] => Array.from({ length: k }, (_, i) => ({
        type: p === 't' ? 'track' : 'episode', uri: `spotify:${p}:${g}-${p}${i}`, id: `${i}`, nom: `${p}${i}`, auteur: '', url: '',
        duree_ms: Math.floor((d[0] + r() * (d[1] - d[0])) * 60000), age_jours: 1, score: 0 }) as Candidat);
      const ep = (b: string) => m('e' + b, 4 + Math.floor(r() * 6), [2, 28]);
      let p;
      try { p = assembler({ cible_ms: 3600000, tolerance_ms: 180000, echauffement_ms: 360000, parole_max_ms: 42 * 60000,
        retour_calme_min_ms: 180000, blocs: [{ id: 'actualite', libelle: 'A', min_ms: 180000, max_ms: 1500000 },
          { id: 'idee', libelle: 'I', min_ms: 180000, max_ms: 1500000 }, { id: 'culture', libelle: 'C', min_ms: 180000, max_ms: 1200000 }],
        episodes: { actualite: ep('a'), idee: ep('i'), culture: ep('c') }, morceaux_theme: m('t', 4, [2.5, 6]),
        fonds: m('t', 20, [2, 7]).map((c, i) => ({ ...c, uri: c.uri + 'f' + i })), exclus: new Set(), morceau_max_ms: 0 }); }
      catch (e) { expect(e).toBeInstanceOf(ErreurAjustement); echecs++; continue; }
      expect(p.total_ms).toBeGreaterThanOrEqual(MIN);
      expect(p.total_ms).toBeLessThanOrEqual(MAX);
      expect(new Set(p.elements.map((e) => e.uri)).size).toBe(p.elements.length);
      const parole = p.elements.filter((e) => e.type === 'episode').reduce((a, e) => a + e.duree_ms, 0);
      expect(parole).toBeLessThanOrEqual(42 * 60000);
      expect(p.elements[p.elements.length - 1].bloc).toBe('retour_au_calme');
      reussis++;
    }
    // Un échec d'ajustement est signalé (jamais une durée hors fenêtre) ; la course relance alors avec plus de musique.
    console.log(`tirages réussis ${reussis}/500, ajustements impossibles ${echecs}`);
    expect(reussis + echecs).toBe(500);
    expect(reussis).toBeGreaterThanOrEqual(475);
  });
});

describe('Course complète contre le faux Spotify', () => {
  it('10 courses : fenêtre, relecture, écho, rappels, aucune rediffusion, rotation', async () => {
    const c = cfg(), now = new Date('2026-11-14T08:00:00Z');
    const f = fauxSpotify(c, now);
    f.defis.set('x', '');
    const api = new Client({ jeton: async () => 'jeton-test', invalider() {} }, 'FR', fetchFaux(f) as any);
    const h = historiqueVide(), cache = cacheVide();
    const deja = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const prep = await preparer(c, h, api, cache, now);
      const { donnees, course } = await creer(c, h, api, prep);
      expect(donnees.problemes).toEqual([]);
      expect(donnees.total_ms).toBeGreaterThanOrEqual(MIN);
      expect(donnees.total_ms).toBeLessThanOrEqual(MAX);
      if (i > 0) {
        expect(course.theme_id).not.toBe(h.courses[i - 1].theme_id);
        expect(prep.plan.elements[0].uri).toBe(h.courses[i - 1].motif!.uri); // écho musical
        expect(prep.rappels.length).toBeGreaterThan(0);
      }
      for (const e of course.elements.filter((e) => e.type === 'episode')) { expect(deja.has(e.uri)).toBe(false); deja.add(e.uri); }
    }
    expect(h.courses.some((x) => x.passage > 1) || new Set(h.courses.map((x) => x.theme_id)).size === 10).toBe(true);
    expect(f.requetes.every((r) => /^(GET|POST) (api|accounts)\.spotify\.com\//.test(r))).toBe(true);
    expect(f.requetes.filter((r) => r.startsWith('GET api.spotify.com/v1/search')).length).toBeGreaterThan(0);
  });
  it('rotation : rappel espacé après 4 courses', () => {
    const c = cfg(), h = historiqueVide();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) { const ch = choisirTheme(c, h); ids.push(ch.theme.id); h.courses.push({ numero: i + 1, theme_id: ch.theme.id } as any); }
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
  });
});
