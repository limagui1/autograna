// ==========================================================================
// LÓGICA DE AUTENTICAÇÃO — usa o Firebase de verdade (não é mais protótipo).
// Você não precisa editar este arquivo. Edite apenas firebase-config.js.
// ==========================================================================
import * as CFG from "./firebase-config.js";
const APP_URL = CFG.APP_URL || "/app";
const FB_CONFIG = (CFG.AUTH_PELO_SITE === true && location.protocol === 'https:') ? Object.assign({}, CFG.firebaseConfig, { authDomain: location.host }) : CFG.firebaseConfig;

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const app = initializeApp(FB_CONFIG);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Mantém a sessão salva neste navegador/aparelho de forma explícita — evita
// cair para uma persistência mais fraca em navegadores/PWAs mais restritivos,
// que é a causa mais comum de "depois de um tempo não deixa entrar de novo".
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Quando o app foi adicionado à tela inicial (modo standalone/PWA), o popup
// do Google costuma falhar silenciosamente nesse tipo de janela. Nesses
// casos usamos redirecionamento em vez de popup.
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

// Se o usuário voltou de um redirecionamento de login do Google, trata aqui.
getRedirectResult(auth).catch((err) => {
  if (err && err.code) toast(friendlyError(err.code));
});

// Se o usuário já está logado, pula direto para o app.
// Também marca este aparelho como "já tem conta": da próxima vez, o site abre direto no app.
onAuthStateChanged(auth, (user) => {
  try { if (user) localStorage.setItem('ag_conta', '1'); else localStorage.removeItem('ag_conta'); } catch (e) {}
  if (user && !document.body.dataset.skipRedirect) {
    window.location.href = APP_URL;
  }
});

const $ = (sel) => document.querySelector(sel);
const views = document.querySelectorAll('[data-view]');
const toastEl = $('[data-el="toast"]');
let toastTimer;

function showView(name) {
  views.forEach(v => v.dataset.active = (v.dataset.view === name) ? '1' : '0');
  if (name !== 'signup' && location.hash === '#criar') history.replaceState(null, '', location.pathname);
}

function toast(msg) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.dataset.show = '1';
  toastTimer = setTimeout(() => { toastEl.dataset.show = '0'; }, 3200);
}

function setLoading(btn, on) {
  btn.dataset.loading = on ? '1' : '0';
  btn.disabled = !!on;
}

function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }

function fieldError(fieldSel, on) {
  const f = document.querySelector(fieldSel);
  f.classList.toggle('has-err', on);
  f.querySelector('input').classList.toggle('err', on);
}

function bannerShow(sel, on, text) {
  const b = document.querySelector(sel);
  b.dataset.show = on ? '1' : '0';
  if (text !== undefined) {
    const span = b.querySelector('span');
    if (span) span.textContent = text;
  }
}

// Traduz os códigos de erro do Firebase para mensagens em português.
function friendlyError(code) {
  const map = {
    'auth/invalid-email': 'Digite um e-mail válido.',
    'auth/user-not-found': 'Não encontramos uma conta com esse e-mail.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente de novo.',
    'auth/email-already-in-use': 'Já existe uma conta com esse e-mail.',
    'auth/weak-password': 'Escolha uma senha mais forte, com pelo menos 8 caracteres.',
    'auth/password-does-not-meet-requirements': 'Escolha uma senha mais forte, com pelo menos 8 caracteres.',
    'auth/popup-closed-by-user': 'Janela do Google fechada antes de concluir.',
    'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
    'auth/unauthorized-domain': 'O login com Google ainda não foi liberado neste endereço do site. Por enquanto, entre com e-mail e senha.',
    'auth/operation-not-allowed': 'Esse jeito de entrar está desativado. Tente com e-mail e senha.',
    'auth/user-disabled': 'Esta conta foi desativada.',
    'auth/missing-password': 'Digite sua senha.',
  };
  if (code === 'auth/unauthorized-domain') console.warn('[Autograna] Autorize "' + location.hostname + '" no Firebase: Authentication > Settings > Authorized domains.');
  if (String(code || '').startsWith('auth/requests-from-referer')) return 'Este endereço do site não está liberado na chave do Firebase. Tente de novo mais tarde.';
  return map[code] || 'Algo deu errado' + (code ? ' (' + code + ')' : '') + '. Tente novamente em instantes.';
}

// toggle de mostrar/ocultar senha
const eyeIcon = {
  off: '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  on: '<path d="M3 3l18 18"/><path d="M10.6 10.6a3 3 0 0 0 4.24 4.24"/><path d="M6.4 6.6C3.9 8.3 1.5 12 1.5 12S5 19 12 19c1.7 0 3.2-.35 4.5-.94"/><path d="M9.9 5.1A10.4 10.4 0 0 1 12 5c7 0 10.5 7 10.5 7a17.9 17.9 0 0 1-2.6 3.7"/>',
};
function wireEye(toggleSel, iconSel, inputSel) {
  const btn = document.querySelector(toggleSel);
  const icon = document.querySelector(iconSel);
  const input = document.querySelector(inputSel);
  let shown = false;
  btn.addEventListener('click', () => {
    shown = !shown;
    input.type = shown ? 'text' : 'password';
    icon.innerHTML = shown ? eyeIcon.on : eyeIcon.off;
    btn.setAttribute('aria-label', shown ? 'Ocultar senha' : 'Mostrar senha');
  });
}
wireEye('[data-el="eye-toggle"]', '[data-el="eye-icon"]', '[data-el="pass-input"]');
wireEye('[data-el="su-eye-toggle"]', '[data-el="su-eye-icon"]', '[data-el="su-pass-input"]');

// navegação entre telas
$('[data-el="forgot-link"]').addEventListener('click', (e) => { e.preventDefault(); showView('forgot'); });
$('[data-el="signup-link"]').addEventListener('click', (e) => { e.preventDefault(); showView('signup'); });
$('[data-el="back-to-login"]').addEventListener('click', () => showView('login'));
$('[data-el="back-to-login-2"]').addEventListener('click', (e) => { e.preventDefault(); showView('login'); });
$('[data-el="back-to-login-3"]').addEventListener('click', () => showView('login'));
$('[data-el="back-to-login-4"]').addEventListener('click', (e) => { e.preventDefault(); showView('login'); });

// Vindo da página de vendas ("Testar grátis" → /entrar#criar), abre direto o cadastro.
const viewFromHash = () => { if (location.hash === '#criar') showView('signup'); };
viewFromHash();
window.addEventListener('hashchange', viewFromHash);

// Google (login e cadastro usam o mesmo fluxo)
const POPUP_FALLBACK_CODES = [
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/cancelled-popup-request',
];
function googleClick(btn) {
  setLoading(btn, true);
  // Dentro do app instalado na tela inicial (modo standalone), o popup do
  // Google normalmente não funciona — usamos redirecionamento direto.
  if (isStandalone()) {
    signInWithRedirect(auth, googleProvider).catch((err) => {
      setLoading(btn, false);
      toast(friendlyError(err.code));
    });
    return;
  }
  signInWithPopup(auth, googleProvider)
    .then(() => {
      showView('success');
      // onAuthStateChanged acima já faz o redirecionamento
    })
    .catch((err) => {
      if (POPUP_FALLBACK_CODES.includes(err.code)) {
        signInWithRedirect(auth, googleProvider).catch((err2) => {
          setLoading(btn, false);
          toast(friendlyError(err2.code));
        });
        return;
      }
      setLoading(btn, false);
      if (err.code !== 'auth/popup-closed-by-user') toast(friendlyError(err.code));
    });
}
$('[data-el="google-btn"]').addEventListener('click', () => googleClick($('[data-el="google-btn"]')));
$('[data-el="google-btn-2"]').addEventListener('click', () => googleClick($('[data-el="google-btn-2"]')));

// LOGIN com e-mail/senha
$('[data-el="login-form"]').addEventListener('submit', (e) => {
  e.preventDefault();
  const emailInput = $('[data-el="email-input"]');
  const passInput = $('[data-el="pass-input"]');
  const email = emailInput.value.trim();
  const pass = passInput.value;
  let ok = true;
  fieldError('[data-el="email-field"]', false);
  fieldError('[data-el="pass-field"]', false);
  bannerShow('[data-el="login-banner"]', false);

  if (!validEmail(email)) { fieldError('[data-el="email-field"]', true); ok = false; }
  if (!pass) { fieldError('[data-el="pass-field"]', true); ok = false; }
  if (!ok) return;

  const btn = $('[data-el="login-submit"]');
  setLoading(btn, true);
  signInWithEmailAndPassword(auth, email, pass)
    .then(() => showView('success'))
    .catch((err) => {
      setLoading(btn, false);
      bannerShow('[data-el="login-banner"]', true, friendlyError(err.code));
    });
});

// ESQUECI MINHA SENHA
$('[data-el="forgot-form"]').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('[data-el="forgot-input"]');
  const email = input.value.trim();
  fieldError('[data-el="forgot-field"]', false);
  bannerShow('[data-el="forgot-banner"]', false);

  if (!validEmail(email)) { fieldError('[data-el="forgot-field"]', true); return; }

  const btn = $('[data-el="forgot-submit"]');
  setLoading(btn, true);
  sendPasswordResetEmail(auth, email)
    .then(() => {
      setLoading(btn, false);
      $('[data-el="sent-email"]').textContent = email;
      showView('sent');
    })
    .catch((err) => {
      setLoading(btn, false);
      bannerShow('[data-el="forgot-banner"]', true, friendlyError(err.code));
    });
});

$('[data-el="resend-btn"]').addEventListener('click', () => {
  const email = $('[data-el="sent-email"]').textContent;
  sendPasswordResetEmail(auth, email)
    .then(() => toast('E-mail reenviado.'))
    .catch((err) => toast(friendlyError(err.code)));
});

// CRIAR CONTA
$('[data-el="signup-form"]').addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = $('[data-el="su-name-input"]');
  const emailInput = $('[data-el="su-email-input"]');
  const passInput = $('[data-el="su-pass-input"]');
  let ok = true;
  fieldError('[data-el="su-name-field"]', false);
  fieldError('[data-el="su-email-field"]', false);
  fieldError('[data-el="su-pass-field"]', false);
  bannerShow('[data-el="signup-banner"]', false);

  if (!nameInput.value.trim()) { fieldError('[data-el="su-name-field"]', true); ok = false; }
  if (!validEmail(emailInput.value)) { fieldError('[data-el="su-email-field"]', true); ok = false; }
  if (passInput.value.length < 8) { fieldError('[data-el="su-pass-field"]', true); ok = false; }
  if (!ok) return;

  const btn = $('[data-el="signup-submit"]');
  setLoading(btn, true);
  createUserWithEmailAndPassword(auth, emailInput.value.trim(), passInput.value)
    .then((cred) => updateProfile(cred.user, { displayName: nameInput.value.trim() }))
    .then(() => showView('success'))
    .catch((err) => {
      setLoading(btn, false);
      bannerShow('[data-el="signup-banner"]', true, friendlyError(err.code));
    });
});
