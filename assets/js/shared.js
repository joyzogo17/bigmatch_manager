/* ================================================================
   BIG MATCH MANAGER v1.0.6 — Cygnus — shared.js
   Shared utilities for login pages.
   ================================================================ */

'use strict';

const BMM_DB_KEY = 'bigMatchDB';

// ── DB HELPERS ────────────────────────────────────────────────────
function bmmGetDB() {
    try { return JSON.parse(localStorage.getItem(BMM_DB_KEY)) || null; } catch { return null; }
}

// ── SESSION AUTH ──────────────────────────────────────────────────
function bmmSaveSession(user) {
    sessionStorage.setItem('bmm_user', JSON.stringify(user));
    sessionStorage.setItem('bmm_role', user.type || 'obs');
}

function bmmGetSession() {
    try { return JSON.parse(sessionStorage.getItem('bmm_user')); } catch { return null; }
}

function bmmClearSession() {
    sessionStorage.removeItem('bmm_user');
    sessionStorage.removeItem('bmm_role');
}

/**
 * Redirect to index.html after successful login.
 * Stores the authenticated user in sessionStorage first.
 */
function bmmLoginRedirect(user) {
    bmmSaveSession(user);
    // Determine correct path depth
    const depth = window.location.pathname.split('/').length - 2;
    const prefix = depth > 0 ? '../'.repeat(depth) : '';
    window.location.href = prefix + 'index.html';
}

// ── ERROR / SUCCESS DISPLAY ───────────────────────────────────────
function bmmShowError(elementId, msg) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<ion-icon name="alert-circle-outline"></ion-icon> ${msg}`;
    el.classList.add('show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('show'), 4500);
}

function bmmHideError(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.classList.remove('show');
}

// ── FOOTER RENDERER ───────────────────────────────────────────────
/**
 * Call bmmRenderFooter() after DOMContentLoaded to inject
 * the standard footer into #bmmFooter.
 */
function bmmRenderFooter() {
    const el = document.getElementById('bmmFooter');
    if (!el) return;
    el.innerHTML = `
    <footer class="login-footer">
      <div><strong>Joy ZOGO ABAGA</strong></div>
      <div>
        <a href="mailto:joyzogo.pro@gmail.com">joyzogo.pro@gmail.com</a>
        &nbsp;·&nbsp; +241 77866740
      </div>
      <div class="footer-links">
        <a href="https://www.facebook.com" target="_blank" rel="noopener">
          <ion-icon name="logo-facebook"></ion-icon> Facebook
        </a>
        <a href="https://www.linkedin.com" target="_blank" rel="noopener">
          <ion-icon name="logo-linkedin"></ion-icon> LinkedIn
        </a>
        <a href="https://wa.me/24177866740" target="_blank" rel="noopener">
          <ion-icon name="logo-whatsapp"></ion-icon> WhatsApp
        </a>
        <a href="https://github.com" target="_blank" rel="noopener">
          <ion-icon name="logo-github"></ion-icon> GitHub
        </a>
      </div>
    </footer>
  `;
}

document.addEventListener('DOMContentLoaded', bmmRenderFooter);

/**
 * togglePwVisibility(inputId, btn)
 * Affiche ou masque un champ mot de passe.
 * Utilisé sur toutes les pages de connexion.
 */
function togglePwVisibility(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    if (btn) {
        btn.innerHTML = inp.type === 'password' ?
            '<ion-icon name="eye-outline"></ion-icon>' :
            '<ion-icon name="eye-off-outline"></ion-icon>';
    }
}