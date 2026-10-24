// ==========================================================================
// Roda sozinho no Netlify antes de cada publicação (comando de build do netlify.toml).
// Pega a configuração das variáveis do Netlify e escreve os arquivos do site — assim o código
// no GitHub não tem nada fixo de um projeto do Firebase e você nunca precisa editar arquivo.
//
//   FIREBASE_WEB_CONFIG  o bloco "firebaseConfig" copiado do Firebase (pode colar do jeito que vem)  [obrigatória]
//   URL                  o endereço do site (o Netlify preenche sozinho)
//   PLAN_PRICE           preço mensal (o mesmo que o servidor cobra), ex.: 39.90
//   SUPORTE_WHATSAPP / SUPORTE_EMAIL                 botão "Falar com uma pessoa" no Copiloto
//   EMPRESA_NOME / EMPRESA_DOCUMENTO / CONTATO_EMAIL seus dados nos Termos de uso e na Privacidade
// ==========================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const fail = msg => { console.error('\n✖ ' + msg + '\n'); process.exit(1); };

// Aceita o bloco do jeito que o Firebase mostra (apiKey: "...") ou em JSON ("apiKey": "...").
const raw = String(process.env.FIREBASE_WEB_CONFIG || '');
const pick = k => { const m = raw.match(new RegExp('["\']?' + k + '["\']?\\s*:\\s*["\']([^"\']*)["\']')); return m ? m[1].trim() : ''; };
const cfg = {
  apiKey: pick('apiKey'), authDomain: pick('authDomain'), projectId: pick('projectId'),
  storageBucket: pick('storageBucket'), messagingSenderId: pick('messagingSenderId'), appId: pick('appId'),
};
if (!raw.trim()) fail('Falta a variável FIREBASE_WEB_CONFIG no Netlify. Cole nela o bloco "firebaseConfig" do Firebase (GUIA.md, etapa 5) e publique de novo.');
if (!cfg.apiKey || !cfg.projectId || !cfg.appId) fail('A variável FIREBASE_WEB_CONFIG está incompleta (precisa ter apiKey, projectId e appId). Copie o bloco "firebaseConfig" inteiro de novo.');
if (!/^[a-z0-9-]{4,40}$/.test(cfg.projectId)) fail('O projectId "' + cfg.projectId + '" não parece certo. Copie o bloco "firebaseConfig" de novo.');
if (!cfg.authDomain) cfg.authDomain = cfg.projectId + '.firebaseapp.com';

// 1) firebase-config.js do site
const js = fs.readFileSync(path.join(site, 'firebase-config.js'), 'utf8');
const block = 'export const firebaseConfig = ' + JSON.stringify(cfg, null, 2) + ';';
const out = js.replace(/export const firebaseConfig = \{[\s\S]*?\};/, block);
if (out === js && !js.includes(block)) fail('Não encontrei o bloco firebaseConfig em site/firebase-config.js.');
fs.writeFileSync(path.join(site, 'firebase-config.js'), out);

// 2) login com Google pelo próprio endereço do site (o Google precisa achar /__/auth/handler aqui)
const fb = 'https://' + cfg.projectId + '.firebaseapp.com';
fs.writeFileSync(path.join(site, '_redirects'),
  '# Gerado por scripts/configurar.mjs — não edite.\n' +
  '/__/auth/*      ' + fb + '/__/auth/:splat      200!\n' +
  '/__/firebase/*  ' + fb + '/__/firebase/:splat  200!\n');

// 3) endereço do site: prévia do link (WhatsApp) e links dos e-mails
const url = String(process.env.URL || '').replace(/\/$/, '');
if (url) {
  const idx = path.join(site, 'index.html');
  const html = fs.readFileSync(idx, 'utf8').replace(/https:\/\/autograna\.netlify\.app/g, url);
  fs.writeFileSync(idx, html);
  fs.writeFileSync(path.join(root, 'netlify', 'lib', 'build-info.mjs'),
    '// Gerado a cada publicação no Netlify por scripts/configurar.mjs (endereço do site para os e-mails).\nexport const SITE_URL = ' + JSON.stringify(url) + ';\n');
}

// 4) preço (o mesmo PLAN_PRICE que o servidor cobra) nas páginas do site
const env = k => String(process.env[k] || '').trim();
const edit = (file, fn) => { const f = path.join(site, file); const a = fs.readFileSync(f, 'utf8'), z = fn(a); if (z !== a) fs.writeFileSync(f, z); };
const price = parseFloat(env('PLAN_PRICE').replace(',', '.'));
if (price > 0 && Math.abs(price - 39.9) > 0.001) {
  const txt = 'R$ ' + price.toFixed(2).replace('.', ',');
  for (const f of ['index.html', 'entrar.html', 'preco.js']) edit(f, h => h.split('R$ 39,90').join(txt));
  console.log('✔ Preço no site: ' + txt);
}

// 5) contato de suporte no Copiloto ("Falar com uma pessoa")
let zap = env('SUPORTE_WHATSAPP').replace(/\D/g, '');
if (/^\d{10,11}$/.test(zap)) zap = '55' + zap; // só DDD + número: completa com o 55 do Brasil
const mail = env('SUPORTE_EMAIL');
if (zap || mail) {
  edit('app.html', h => h.replace(/const COP_SUPPORT = \{[^}]*\};/, 'const COP_SUPPORT = ' + JSON.stringify({ whatsapp: zap, email: mail }).replace(/"/g, "'") + ';'));
  console.log('✔ Suporte no Copiloto: ' + [zap && 'WhatsApp', mail && 'e-mail'].filter(Boolean).join(' e '));
}

// 6) seus dados nos Termos de uso e na Política de privacidade
const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fills = { '[NOME DO RESPONSÁVEL OU EMPRESA]': env('EMPRESA_NOME'), '[CPF OU CNPJ]': env('EMPRESA_DOCUMENTO'), '[E-MAIL DE CONTATO]': env('CONTATO_EMAIL') };
const missing = Object.entries(fills).filter(([, v]) => !v).map(([k]) => k);
for (const f of ['termos.html', 'privacidade.html']) edit(f, h => {
  for (const [k, v] of Object.entries(fills)) if (v) h = h.split('<span class="fill">' + k + '</span>').join(esc(v));
  return h;
});
if (missing.length) console.log('⚠ Termos e Privacidade ainda sem: ' + missing.join(', ') + ' (variáveis EMPRESA_NOME, EMPRESA_DOCUMENTO e CONTATO_EMAIL).');
else console.log('✔ Termos e Privacidade com os seus dados');

console.log('✔ Firebase configurado: projeto ' + cfg.projectId);
console.log('✔ Login com Google pelo endereço do site: /__/auth → ' + fb);
console.log('✔ Endereço do site: ' + (url || '(o Netlify vai preencher na publicação)'));
