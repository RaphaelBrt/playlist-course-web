import './styles.css';
import { Session, echanger } from '../logic/auth';
import { type Config, analyser } from '../logic/config';
import { type Preparation, creer, preparer } from '../logic/course';
import { type Donnees, dateFr, duree, echoMusical, horloge, minutes, num3, passage, pont, source, texte as ficheTexte } from '../logic/fiche';
import { lireHistorique } from '../logic/historique';
import { defi, etatAleatoire, nouveauVerificateur, urlAutorisation, uriRedirection, verifierRedirection } from '../logic/pkce';
import { COMPTES_BASE, Client } from '../logic/spotify';
import { choisirTheme } from '../logic/theme';
import { coffre, stock } from './stockage';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const app = $('#vue');
const statut = $('#statut');

let cfg: Config | null = null;
let erreurProfil = '';
let prep: Preparation | null = null;
let themeForce = '';
let occupe = '';
let erreur = '';
const redirection = () => uriRedirection(location);
const connecte = () => !!coffre.lire();
const session = new Session(coffre, (i, o) => fetch(i, o));
const api = () => new Client(session, cfg!.marche);

function annoncer(m: string) { statut.textContent = m; }

// ---------- Connexion PKCE ----------
async function seConnecter() {
  const verificateur = nouveauVerificateur(), etat = etatAleatoire(), r = redirection();
  stock.setPkce({ verificateur, etat, redirection: r });
  location.assign(urlAutorisation(COMPTES_BASE, stock.clientId(), r, etat, await defi(verificateur)));
}

async function retourConnexion(): Promise<string> {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return '';
  history.replaceState(null, '', location.pathname + '#reglages');
  const p = stock.pkce();
  stock.setPkce(null);
  if (q.get('error')) return `Connexion refusée par Spotify (${q.get('error')}).`;
  if (!p) return 'Connexion terminée hors de l’app (stockage différent) : relancez « Se connecter » depuis l’app installée.';
  if (p.etat !== q.get('state')) return 'Réponse de Spotify non reconnue (état différent) : relancez la connexion.';
  try {
    coffre.ecrire(await echanger((i, o) => fetch(i, o), stock.clientId(), q.get('code')!, p.redirection, p.verificateur));
    return 'ok';
  } catch (e) { return (e as Error).message; }
}

// ---------- Frise ----------
const kind = (bloc: string) => ['echauffement', 'intermede', 'retour_au_calme'].includes(bloc) ? 'musique' : bloc;
const NOMS: Record<string, string> = { musique: 'Musique', actualite: 'Actualité', idee: 'Idées', culture: 'Culture' };

function frise(d: Donnees): string {
  const echelle = (cfg!.duree_cible_min + cfg!.tolerance_min) * 60000;
  const debutFenetre = ((cfg!.duree_cible_min - cfg!.tolerance_min) * 60000) / echelle * 100;
  const segs = d.plan.elements.map((e) => `<span class="seg k-${kind(e.bloc)}" style="width:${(e.duree_ms / echelle) * 100}%" title="${esc(e.nom)} · ${esc(duree(e.duree_ms))}"></span>`).join('');
  const parts: Record<string, number> = {};
  for (const e of d.plan.elements) parts[kind(e.bloc)] = (parts[kind(e.bloc)] ?? 0) + e.duree_ms;
  const ticks = [0, 15, 30, 45, 60].map((m) => `<span class="tick" style="left:${(m * 60000 / echelle) * 100}%">${m}</span>`).join('');
  return `<figure class="frise" aria-label="Déroulé de la course : ${esc(duree(d.total_ms))}">
    <div class="piste"><span class="fenetre" style="left:${debutFenetre}%" aria-hidden="true"></span>${segs}</div>
    <div class="ticks" aria-hidden="true">${ticks}</div>
    <figcaption><ul class="legende">${Object.entries(parts).map(([k, ms]) => `<li><i class="pastille k-${k}" aria-hidden="true"></i>${NOMS[k] ?? k} <b>${minutes(ms)} min</b></li>`).join('')}</ul>
    <p class="total"><b>${esc(duree(d.total_ms))}</b> ${d.total_relu ? 'relus dans la playlist' : 'prévus'} · fenêtre ${cfg!.duree_cible_min - cfg!.tolerance_min}–${cfg!.duree_cible_min + cfg!.tolerance_min} min</p></figcaption></figure>`;
}

function programme(d: Donnees): string {
  return `<ol class="programme">${d.plan.elements.map((e) => `<li class="k-${kind(e.bloc)}">
    <span class="h">${horloge(e.debut_ms)}</span>
    <span class="quoi"><span class="bloc">${esc(e.libelle)}</span>
      ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.nom)}</a>` : esc(e.nom)}
      <span class="meta">${esc(e.auteur || '—')} · ${esc(duree(e.duree_ms))}${e.type === 'episode' && e.date_sortie ? ` · diffusé le ${esc(e.date_sortie)}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</span></span></li>`).join('')}</ol>
    ${d.plan.blocs_vides.length ? `<p class="avert">Blocs sans épisode adapté, remplacés par de la musique : ${esc(d.plan.blocs_vides.join(', '))}.</p>` : ''}`;
}

// ---------- Vues ----------
function vueCourse(): string {
  if (!cfg) return `<h1>Course du jour</h1><p class="erreur">${esc(erreurProfil || 'Chargement du profil…')}</p>`;
  const h = stock.historique();
  const fiche = stock.fiche();
  const cree = fiche && !fiche.apercu && h.courses.at(-1)?.numero === fiche.numero ? fiche : null;
  const d: Donnees | null = prep ?? cree;
  let choix;
  try { choix = d?.choix ?? choisirTheme(cfg, h, themeForce); } catch (e) { return `<p class="erreur">${esc((e as Error).message)}</p>`; }
  const numero = d?.numero ?? (h.courses.at(-1)?.numero ?? 0) + 1;
  let action = '';
  if (!stock.clientId()) action = `<p>Pour commencer, indiquez le Client ID de votre application Spotify.</p><a class="btn primaire" href="#reglages">Ouvrir les réglages</a>`;
  else if (!connecte()) action = `<button class="btn primaire" data-act="connexion">Se connecter à Spotify</button>`;
  else if (occupe) action = `<p class="occupe" role="status">${esc(occupe)}</p>`;
  else if (prep) action = `<div class="actions"><button class="btn primaire" data-act="creer">Créer la playlist</button><button class="btn" data-act="preparer">Préparer à nouveau</button></div>`;
  else if (cree) action = `<div class="actions"><a class="btn primaire" href="${esc(cree.playlist_url)}" target="_blank" rel="noopener">Ouvrir dans Spotify</a><a class="btn" href="#fiche">Voir la fiche</a><button class="btn" data-act="preparer">Préparer la course suivante</button></div>`;
  else action = `<button class="btn primaire" data-act="preparer">Préparer la course</button>`;
  const choixTheme = !d && !occupe ? `<details class="force"><summary>Changer de thème</summary>
    <label for="theme">Thème</label><select id="theme" name="theme"><option value="">Automatique (rotation espacée)</option>
    ${cfg.themes.map((t) => `<option value="${esc(t.id)}"${t.id === themeForce ? ' selected' : ''}>${esc(t.titre)}</option>`).join('')}</select></details>` : '';
  return `<header class="tete"><p class="numero" aria-label="Course ${numero}">${num3(numero)}</p>
    <div><h1>${esc(choix.theme.titre)}</h1><p class="sous">${esc(choix.theme.famille)} · ${esc(passage(choix))}</p></div></header>
    <blockquote class="paradoxe">${esc(choix.theme.paradoxe)}</blockquote>
    <p class="question"><span>Question pendant la course</span>${esc(choix.question)}</p>
    ${erreur ? `<p class="erreur" role="alert">${esc(erreur)}</p>` : ''}
    ${d ? frise(d) : ''}
    ${cree && cree.problemes?.length ? `<p class="erreur">Écarts à la relecture : ${esc(cree.problemes.join(' ; '))}</p>` : ''}
    ${cree && !cree.problemes?.length ? `<p class="ok">Playlist créée et relue : ${cree.plan.elements.length} éléments, tous jouables.</p>` : ''}
    <div class="zone-action">${action}</div>${choixTheme}
    ${d ? `<h2>Programme</h2>${programme(d)}` : ''}`;
}

function vueFiche(): string {
  const d = prep ?? stock.fiche();
  if (!d || !cfg) return `<h1>Fiche</h1><p>Aucune fiche pour l’instant. Préparez une course pour obtenir sa fiche.</p><a class="btn" href="#course">Course du jour</a>`;
  const p = pont(d), e = echoMusical(d);
  return `<article class="fiche">
    ${d.apercu ? '<p class="bandeau">Aperçu : playlist pas encore créée.</p>' : ''}
    <header class="tete"><p class="numero">${num3(d.numero)}</p><div><h1>${esc(d.choix.theme.titre)}</h1><p class="sous">${esc(dateFr(d.date))} · ${esc(passage(d.choix))}</p></div></header>
    <h2>Paradoxe</h2><blockquote class="paradoxe">${esc(d.choix.theme.paradoxe)}</blockquote>
    <h2>Trois concepts à retenir</h2><ol class="concepts">${d.choix.concepts.map((c) => `<li><b>${esc(c.nom)}</b> — ${esc(c.definition)}</li>`).join('')}</ol>
    <h2>Question pendant la course</h2><p>${esc(d.choix.question)}</p>
    <h2>Lien avec la course précédente</h2><p>${esc(p.texte)}</p>${p.liaison ? `<p class="liaison"><b>Question de liaison :</b> ${esc(p.liaison)}</p>` : ''}
    ${e ? `<p><b>Écho musical :</b> ${esc(e)}</p>` : ''}
    ${d.rappels.length ? `<h2>Rappels espacés</h2><p class="aide">Répondez sans regarder ; réponses en fin de fiche.</p><ul>${d.rappels.map((r) => `<li>Course ${num3(r.course)} (${esc(r.titre)}) : que recouvre « ${esc(r.concept)} » ?</li>`).join('')}</ul>` : ''}
    <h2>Programme</h2>${frise(d)}${programme(d)}
    ${d.playlist_url ? `<p><a href="${esc(d.playlist_url)}" target="_blank" rel="noopener">Ouvrir la playlist dans Spotify</a></p>` : ''}
    ${d.rappels.length ? `<section class="reponses"><h2>Réponses des rappels</h2><ul>${d.rappels.map((r) => `<li><b>${esc(r.concept)}</b> : ${esc(r.definition)}</li>`).join('')}</ul></section>` : ''}
    <p class="source">${esc(source(d))}</p>
    <div class="actions ecran"><button class="btn primaire" data-act="imprimer">Imprimer (A4)</button><button class="btn" data-act="copier">Copier en texte</button></div></article>`;
}

function vueHistorique(): string {
  const h = stock.historique();
  const liste = h.courses.slice().reverse().map((c) => `<li><span class="numero petit">${num3(c.numero)}</span>
    <span class="quoi"><b>${esc(c.theme_titre)}</b><span class="meta">${esc(dateFr(new Date(c.date)))} · ${esc(duree(c.duree_ms))} · passage ${c.passage}</span>
    <span class="meta">${esc((c.concepts ?? []).join(', '))}</span></span>
    ${c.playlist_url ? `<a class="btn petit" href="${esc(c.playlist_url)}" target="_blank" rel="noopener" aria-label="Ouvrir la course ${c.numero} dans Spotify">Ouvrir</a>` : ''}</li>`).join('');
  return `<h1>Historique</h1>
    ${h.courses.length ? `<p class="aide">${h.courses.length} course${h.courses.length > 1 ? 's' : ''}. Aucun épisode n’est rediffusé d’une course à l’autre.</p><ol class="histo">${liste}</ol>`
      : '<p>Aucune course pour l’instant. Votre première playlist apparaîtra ici.</p>'}
    <h2>Sauvegarde</h2><p class="aide">L’historique est gardé sur cet appareil. Exportez-le de temps en temps ; le fichier est compatible avec le programme Mac et Windows (historique.json).</p>
    <div class="actions"><button class="btn" data-act="exporter">Exporter</button>
    <label class="btn">Importer<input type="file" accept="application/json,.json" id="import" class="cache"></label>
    ${h.courses.length ? '<button class="btn danger" data-act="effacer">Effacer l’historique</button>' : ''}</div>`;
}

function vueReglages(): string {
  const r = redirection(), diag = verifierRedirection(r);
  return `<h1>Réglages</h1>
    <h2>Application Spotify</h2>
    <form id="form-client"><label for="client">Client ID</label>
    <input id="client" name="client" value="${esc(stock.clientId())}" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="text" placeholder="32 caractères, ex. 1a2b3c…" enterkeyhint="done">
    <button class="btn" type="submit">Enregistrer le Client ID</button></form>
    <p class="aide">Le Client ID n’est pas un secret. Le « Client secret » ne sert pas et ne doit être saisi nulle part.</p>
    <p><b>URI de redirection à déclarer</b> dans le tableau de bord Spotify :</p>
    <p class="uri"><code translate="no">${esc(r)}</code> <button class="btn petit" data-act="copier-uri">Copier</button></p>
    ${diag.ok ? '' : `<p class="erreur">${esc(diag.raison)}</p>`}
    <h2>Connexion</h2>
    <p>${connecte() ? 'Connecté à Spotify. Jeton gardé sur cet appareil uniquement.' : 'Non connecté.'}</p>
    <div class="actions">${connecte() ? '<button class="btn" data-act="deconnexion">Se déconnecter</button>' : `<button class="btn primaire" data-act="connexion"${stock.clientId() && diag.ok ? '' : ' disabled'}>Se connecter à Spotify</button>`}</div>
    <h2>Profil d’intérêts</h2>
    ${cfg ? `<p>${cfg.themes.length} thèmes, ${cfg.emissions.length} émissions, ${cfg.musique_generale.length + cfg.themes.reduce((a, t) => a + t.musique.length, 0)} morceaux (fiches Mélomane). Marché ${esc(cfg.marche)}, course de ${cfg.duree_cible_min} ± ${cfg.tolerance_min} min.</p>` : `<p class="erreur">${esc(erreurProfil)}</p>`}
    <p class="aide">Aucune donnée ne quitte l’appareil, sauf les appels à Spotify.</p>`;
}

const VUES: Record<string, () => string> = { course: vueCourse, fiche: vueFiche, historique: vueHistorique, reglages: vueReglages };
function rendre() {
  const v = location.hash.slice(1) || 'course';
  const f = VUES[v] ?? vueCourse;
  app.innerHTML = f();
  document.querySelectorAll('nav a').forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + (VUES[v] ? v : 'course')));
  document.title = { course: 'Course du jour', fiche: 'Fiche', historique: 'Historique', reglages: 'Réglages' }[VUES[v] ? v : 'course'] + ' · Playlist course';
}

// ---------- Actions ----------
async function agir(act: string) {
  erreur = '';
  try {
    if (act === 'connexion') return await seConnecter();
    if (act === 'deconnexion') { coffre.effacer(); prep = null; annoncer('Déconnecté.'); }
    if (act === 'preparer') {
      occupe = 'Recherche des émissions et des morceaux dans Spotify…'; rendre();
      const cache = stock.cache();
      try { prep = await preparer(cfg!, stock.historique(), api(), cache, new Date(), themeForce, (m) => annoncer(m)); stock.setFiche(prep); }
      finally { stock.setCache(cache); occupe = ''; }
      annoncer(`Course prête : ${duree(prep.total_ms)}.`);
    }
    if (act === 'creer' && prep) {
      occupe = 'Création de la playlist, puis relecture…'; rendre();
      const h = stock.historique();
      try { const { donnees } = await creer(cfg!, h, api(), prep); stock.setHistorique(h); stock.setFiche(donnees); prep = null; themeForce = ''; }
      finally { occupe = ''; }
      annoncer('Playlist créée et relue.');
    }
    if (act === 'imprimer') return window.print();
    if (act === 'copier') { const d = prep ?? stock.fiche(); if (d) { await navigator.clipboard.writeText(ficheTexte(d)); annoncer('Fiche copiée.'); } return; }
    if (act === 'copier-uri') { await navigator.clipboard.writeText(redirection()); annoncer('URI copiée.'); return; }
    if (act === 'exporter') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(stock.historique(), null, 2)], { type: 'application/json' }));
      a.download = `historique-courses-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      return;
    }
    if (act === 'effacer' && confirm('Effacer l’historique de cet appareil ? Exportez-le d’abord si besoin.')) { stock.setHistorique({ courses: [] }); stock.setFiche(null); }
  } catch (e) { erreur = (e as Error).message; annoncer(erreur); }
  rendre();
}

document.addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (b && !(b as HTMLButtonElement).disabled) { ev.preventDefault(); void agir(b.dataset.act!); }
});
document.addEventListener('change', async (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.id === 'theme') { themeForce = t.value; rendre(); }
  if (t.id === 'import' && t.files?.[0]) {
    try { stock.setHistorique(lireHistorique(JSON.parse(await t.files[0].text()))); annoncer('Historique importé.'); }
    catch (e) { annoncer((e as Error).message); alert((e as Error).message); }
    rendre();
  }
});
document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  stock.setClientId(($('#client') as HTMLInputElement).value);
  annoncer('Client ID enregistré.'); rendre();
});
window.addEventListener('hashchange', rendre);

(async () => {
  const msg = await retourConnexion();
  try {
    const r = await fetch('./interets.json', { cache: 'no-cache' });
    cfg = analyser(await r.json());
  } catch (e) { erreurProfil = 'Profil interets.json illisible : ' + (e as Error).message; }
  if (msg === 'ok') { location.hash = '#course'; annoncer('Connecté à Spotify.'); }
  else if (msg) { erreur = msg; location.hash = '#reglages'; }
  rendre();
  if (erreur && location.hash === '#reglages') app.insertAdjacentHTML('afterbegin', `<p class="erreur" role="alert">${esc(erreur)}</p>`);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
