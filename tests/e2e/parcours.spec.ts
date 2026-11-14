import { expect, test } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { analyser } from '../../src/logic/config';
import { fauxSpotify } from '../fake/fauxSpotify';

const CAPTURES = 'dist/captures';
mkdirSync(CAPTURES, { recursive: true });

test('parcours complet contre un faux Spotify (données SIMULÉES)', async ({ page, context }) => {
  const cfg = analyser(JSON.parse(readFileSync('public/interets.json', 'utf8')));
  const f = fauxSpotify(cfg, new Date());
  const horsSpotify: string[] = [], consoleErr: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErr.push(m.text()); });
  page.on('pageerror', (e) => consoleErr.push(e.message));
  await context.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.host === '127.0.0.1:4173') return route.continue();
    if (u.host === 'accounts.spotify.com' && u.pathname === '/authorize') {
      const q = u.searchParams;
      expect(q.get('code_challenge_method')).toBe('S256');
      expect(q.get('response_type')).toBe('code');
      expect(q.get('redirect_uri')).toBe('http://127.0.0.1:4173/');
      f.defis.set('code-test', q.get('code_challenge')!);
      return route.fulfill({ status: 302, headers: { location: `${q.get('redirect_uri')}?code=code-test&state=${q.get('state')}` } });
    }
    if (u.host === 'accounts.spotify.com' || u.host === 'api.spotify.com') {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      const r = f.traiter(req.method(), req.url(), await req.allHeaders(), req.postData() ?? '');
      return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r.body) });
    }
    horsSpotify.push(req.url());
    return route.abort();
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#course');
  await expect(page.getByText('indiquez le Client ID')).toBeVisible();
  await page.getByRole('link', { name: 'Ouvrir les réglages' }).click();
  await page.getByLabel('Client ID').fill('0123456789abcdef0123456789abcdef');
  await page.getByRole('button', { name: 'Enregistrer le Client ID' }).click();
  await expect(page.locator('.uri code')).toHaveText('http://127.0.0.1:4173/');
  await page.screenshot({ path: `${CAPTURES}/375-reglages.png`, fullPage: true });
  await page.getByRole('button', { name: 'Se connecter à Spotify' }).click();
  await expect(page.getByRole('button', { name: 'Préparer la course' })).toBeVisible();
  expect(f.requetes).toContain('POST accounts.spotify.com/api/token'); // PKCE vérifié par le faux serveur
  await expect(page.locator('.numero').first()).toHaveText('001');
  await page.screenshot({ path: `${CAPTURES}/375-course-avant.png`, fullPage: true });

  // Course 1 : aperçu, création, relecture.
  await page.getByRole('button', { name: 'Préparer la course' }).click();
  await expect(page.getByRole('button', { name: 'Créer la playlist' })).toBeVisible();
  await expect(page.locator('.frise .seg').first()).toBeVisible();
  const total = await page.locator('.total b').textContent();
  const min = parseInt(total!, 10); expect(min).toBeGreaterThanOrEqual(57); expect(min).toBeLessThanOrEqual(63);
  await page.screenshot({ path: `${CAPTURES}/375-course-apercu.png`, fullPage: true });
  await page.getByRole('button', { name: 'Créer la playlist' }).click();
  await expect(page.locator('main .ok')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ouvrir dans Spotify' })).toHaveAttribute('href', /^https:\/\/open\.spotify\.com\/playlist\//);
  expect(f.playlists.size).toBe(1);

  // Course 2 : écho musical, question de liaison, rappels.
  await page.getByRole('button', { name: 'Préparer la course suivante' }).click();
  await page.getByRole('button', { name: 'Créer la playlist' }).click();
  await expect(page.locator('main .ok')).toBeVisible();
  await expect(page.locator('.numero').first()).toHaveText('002');
  await page.getByRole('link', { name: 'Fiche', exact: true }).click();
  await expect(page.getByText(/fermait la course 001 et ouvre celle-ci/)).toBeVisible();
  await expect(page.getByText('Question de liaison :')).toBeVisible();
  await expect(page.getByText(/Course 001 .* : que recouvre/)).toBeVisible();
  await page.screenshot({ path: `${CAPTURES}/375-fiche.png`, fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${CAPTURES}/fiche-A4.pdf`, format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });

  await page.getByRole('link', { name: 'Historique' }).click();
  await expect(page.locator('.histo li')).toHaveCount(2);
  await page.screenshot({ path: `${CAPTURES}/375-historique.png`, fullPage: true });

  // Bureau 1280 et mode sombre.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('link', { name: 'Course', exact: true }).click();
  await page.screenshot({ path: `${CAPTURES}/1280-course.png`, fullPage: true });
  await page.getByRole('link', { name: 'Fiche', exact: true }).click();
  await page.screenshot({ path: `${CAPTURES}/1280-fiche.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('link', { name: 'Course', exact: true }).click();
  await page.screenshot({ path: `${CAPTURES}/375-course-sombre.png`, fullPage: true });

  // Pas de débordement horizontal à 375 px.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(horsSpotify, 'requêtes hors Spotify').toEqual([]);
  expect(consoleErr, 'console').toEqual([]);
  // Le jeton et l'historique restent dans le stockage local.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pc.historique')!).courses.length)).toBe(2);
});
