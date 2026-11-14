# Déployer la web app playlist-course (site statique, sans serveur)

Le dossier à publier est `dist/site/` (ou le résultat de `npm ci && npm run build`). Rien n'est publié tant que vous ne l'avez pas décidé.

## 1. URI de redirection Spotify (règle commune)

Spotify exige une adresse **HTTPS** identique, caractère pour caractère, à celle de la page (seule exception : `http://127.0.0.1:PORT/` en local ; `localhost` est refusé).
Dans https://developer.spotify.com/dashboard → votre app (celle du programme Mac/Windows convient) → **Settings** → **Redirect URIs**, ajoutez l'adresse affichée dans **Réglages** de la web app, par exemple :

- GitHub Pages : `https://raphaelbrt.github.io/playlist-course-web/`
- Cloudflare Pages : `https://playlist-course.pages.dev/`

Gardez `http://127.0.0.1:8888/callback` pour le programme en ligne de commande. Votre compte doit figurer dans **User Management** et le propriétaire de l'app doit être Premium.

## 2a. GitHub Pages (nouveau dépôt)

1. Créez un dépôt **privé ou public** `playlist-course-web` et poussez ce code source (le `.gitignore` exclut `config.js`, `dist/`, `node_modules/`).
2. Construisez : `npm ci && npm run build`, puis publiez `dist/site/` sur la branche `gh-pages` (`npx gh-pages -d dist/site`) ou via une action GitHub Pages ; **Settings → Pages → Source : gh-pages**.
3. Ouvrez `https://<compte>.github.io/playlist-course-web/`, copiez l'URI affichée dans Réglages et ajoutez-la à Spotify (§ 1).

## 2b. Autre hébergeur statique gratuit (Cloudflare Pages, Netlify)

Glissez-déposez `dist/site/` dans « Direct Upload » (Cloudflare Pages) ou « Deploy manually » (Netlify). HTTPS est fourni. Ajoutez l'URI à Spotify (§ 1).

## 3. Sur l'iPhone

Safari → l'adresse → **Partager** → **Sur l'écran d'accueil**. Ouvrez l'app depuis l'icône, puis **Réglages** : collez le Client ID (une fois) et **Se connecter à Spotify** depuis l'app installée (l'app installée a son propre stockage, distinct de Safari).

## Client ID pré-rempli (facultatif)

Copiez `config.example.js` en `config.js` avant `npm run build` : il sera copié dans le site et chargé. Ce fichier n'est pas versionné. Le Client ID n'est pas un secret ; aucun secret n'est nécessaire (flux PKCE).

## Tester en local

`npm run build && npx vite preview` puis http://127.0.0.1:4173/ (URI à déclarer : `http://127.0.0.1:4173/`).
