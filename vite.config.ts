import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// config.js (non versionné) : copié et chargé seulement s'il existe, pour éviter toute requête 404.
function configLocale(): Plugin {
  const present = existsSync('config.js');
  return {
    name: 'config-locale',
    transformIndexHtml: (html) => html.replace('<!--CONFIG-->', present ? '<script src="./config.js"></script>' : ''),
    generateBundle() { if (present) this.emitFile({ type: 'asset', fileName: 'config.js', source: readFileSync('config.js', 'utf8') }); },
  };
}

// Service worker : liste de précache et version calculées sur les fichiers construits.
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    closeBundle() {
      const dist = 'dist/site';
      const fichiers: string[] = [];
      const parcourir = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? parcourir(p) : fichiers.push(relative(dist, p)); } };
      parcourir(dist);
      const liste = fichiers.filter((f) => f !== 'sw.js' && f !== 'config.js').sort();
      const h = createHash('sha256'); for (const f of liste) h.update(f).update(readFileSync(join(dist, f)));
      const modele = readFileSync('src/sw.js', 'utf8');
      writeFileSync(join(dist, 'sw.js'), modele.replace('__VERSION__', h.digest('hex').slice(0, 12)).replace('__FICHIERS__', JSON.stringify(['./', ...liste.map((f) => './' + f)])));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [configLocale(), serviceWorker()],
  build: { outDir: 'dist/site', emptyOutDir: true, modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
});
