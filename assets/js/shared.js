/* ================================================================
   BIG MATCH MANAGER — shared.js
   Version : 1.0.6 — Cygnus
   Rôle    : Utilitaires partagés entre les pages de CONNEXION
             Chargé par : login.html, login-equipe.html,
                          admin/admin-login.html
             NON chargé par index.html (script.js est autonome)
   ================================================================ */
'use strict';

// ── CLÉ DB (doit correspondre à DB_KEY dans script.js) ─────────────
const BMM_DB_KEY = 'bigMatchDB';

// ── SESSION ──────────────────────────────────────────────────────────
function bmmSaveSession(user) {
  sessionStorage.setItem('bmm_user', JSON.stringify(user));
  sessionStorage.setItem('bmm_role', user.type || 'obs');
}
function bmmGetSession() {
  try { return JSON.parse(sessionStorage.getItem('bmm_user')); }
  catch { return null; }
}
function bmmClearSession() {
  sessionStorage.removeItem('bmm_user');
  sessionStorage.removeItem('bmm_role');
}

// ── REDIRECTION APRÈS CONNEXION ───────────────────────────────────────
/**
 * bmmLoginRedirect(user)
 * Sauvegarde l'utilisateur en sessionStorage puis redirige vers index.html.
 * Gère automatiquement le chemin relatif depuis admin/ ou depuis la racine.
 */
function bmmLoginRedirect(user) {
  bmmSaveSession(user);
  const isInAdmin = window.location.pathname.includes('/admin/');
  window.location.href = isInAdmin ? '../index.html' : 'index.html';
}

// ── LECTURE DB ────────────────────────────────────────────────────────
/**
 * bmmGetDB()
 * Lit la base de données locale depuis localStorage.
 * Utilisé par les pages de connexion pour valider les mots de passe.
 */
function bmmGetDB() {
  try { return JSON.parse(localStorage.getItem(BMM_DB_KEY)); }
  catch { return null; }
}

// ── ERREURS FORMULAIRE ────────────────────────────────────────────────
function bmmShowError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}
function bmmHideError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}

// ── FOOTER ────────────────────────────────────────────────────────────
function bmmRenderFooter() {
  const el = document.getElementById('bmmFooter');
  if (el) el.innerHTML =
    '<p style="margin:0;font-size:11px;color:#6b9a78">Big Match Manager v1.0.6 &mdash; Cygnus &nbsp;&middot;&nbsp; &copy; Joyeux Zogo Abaga</p>';
}

// ── TOGGLE MOT DE PASSE (œil) ─────────────────────────────────────────
/**
 * togglePwVisibility(inputId, btn)
 * Affiche ou masque un champ mot de passe.
 * Utilisé sur : login-equipe.html, admin/admin-login.html
 * NOTE : Une version identique existe dans script.js pour l'overlay
 *        de connexion interne dans index.html. Les deux sont indépendantes
 *        et nécessaires car shared.js n'est pas chargé dans index.html.
 */
function togglePwVisibility(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.innerHTML = inp.type === 'password'
    ? '<ion-icon name="eye-outline"></ion-icon>'
    : '<ion-icon name="eye-off-outline"></ion-icon>';
}
