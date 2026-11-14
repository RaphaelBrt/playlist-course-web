# playlist-course-web

Web app installable (PWA) qui porte le programme `playlist-course` : une course, une playlist Spotify de 57 à 63 min (échauffement, actualité de moins de 30 jours avec repli à 90, idées, culture, intermèdes, retour au calme), thème à paradoxe en rotation espacée (4, 8, 16), écho musical, question de liaison, rappels n−1/n−3/n−7, aucun épisode rediffusé, marché FR, relecture de la playlist après création, fiche imprimable A4.

- Connexion Spotify par PKCE, sans secret ; jeton, historique et cache restent dans le navigateur (localStorage). La politique de sécurité (CSP) n'autorise que `api.spotify.com` et `accounts.spotify.com`.
- `public/interets.json` : profil (thèmes, émissions, musique des fiches Mélomane), modifiable sans reconstruire.
- Historique exportable/importable, compatible avec `historique.json` du programme Mac/Windows.

```
npm ci
npm test            # tests unitaires (Vitest)
npm run build       # site statique dans dist/site/
npm run e2e         # parcours Playwright contre un faux Spotify (données SIMULÉES)
```

Déploiement : voir `DEPLOIEMENT.md`.
