// ==========================================================================
// Núcleo do servidor do Autograna (Netlify Functions).
// Sem dependências externas: usa só fetch e crypto do próprio Node.
//
// Variáveis de ambiente (Netlify > Site configuration > Environment variables):
//   MP_ACCESS_TOKEN           Access Token de PRODUÇÃO do Mercado Pago (obrigatório)
//   MP_WEBHOOK_SECRET         Assinatura secreta dos Webhooks do Mercado Pago (recomendado)
//   FIREBASE_SERVICE_ACCOUNT  JSON inteiro da conta de serviço do Firebase (obrigatório)
//   ADMIN_EMAILS              E-mails com acesso ao painel, separados por vírgula
//   PLAN_PRICE                Preço mensal, ex.: 39.90 (padrão 39.90)
//   TRIAL_DAYS                Dias de teste grátis (padrão 3)
//   FIREBASE_WEB_CONFIG       bloco "firebaseConfig" do Firebase (o mesmo que o site usa; daqui sai a apiKey)
//   MP_PUBLIC_KEY             Public Key de PRODUÇÃO do Mercado Pago (cartão digitado dentro do app)
//   SMTP_USER / SMTP_PASS     E-mails automáticos pelo Gmail (senha de app) — ou RESEND_API_KEY + EMAIL_FROM
//   LINK_SECRET               (opcional) segredo dos links dos e-mails; sem ele, usa um derivado da conta de serviço
// ==========================================================================
import crypto from 'node:crypto';
import { SITE_URL as BUILD_SITE_URL } from './build-info.mjs';

// apiKey do projeto do Firebase: vem da mesma variável que configura o site (ou de FIREBASE_API_KEY).
function firebaseApiKey() {
  if (process.env.FIREBASE_API_KEY) return String(process.env.FIREBASE_API_KEY).trim();
  const m = String(process.env.FIREBASE_WEB_CONFIG || '').match(/["']?apiKey["']?\s*:\s*["']([^"']+)["']/);
  if (m) return m[1].trim();
  throw new HttpError(500, 'Servidor sem FIREBASE_WEB_CONFIG configurado.');
}
const DAY = 86400000;
// Mesmo e-mail que está em firestore.rules (isAdmin). ADMIN_EMAILS no Netlify substitui.
const DEFAULT_ADMIN = 'autograna11@gmail.com';

export const cfg = () => ({
  price: Math.round(parseFloat(String(process.env.PLAN_PRICE || '39.90').replace(',', '.')) * 100) / 100,
  trialDays: Math.max(0, parseInt(process.env.TRIAL_DAYS || '3', 10) || 0),
  admins: String(process.env.ADMIN_EMAILS || DEFAULT_ADMIN).split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  graceDays: Math.max(0, parseInt(process.env.GRACE_DAYS || '3', 10) || 0),
  publicKey: String(process.env.MP_PUBLIC_KEY || '').trim(),
});
export const siteUrl = () => String(process.env.SITE_URL || process.env.URL || BUILD_SITE_URL || 'https://autograna.netlify.app').replace(/\/$/, '');

export class HttpError extends Error { constructor(status, msg, upstream) { super(msg); this.status = status; this.upstream = upstream || 0; } }

export const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

// --------------------------------------------------------------------------
// Login: confere o token do Firebase do usuário no próprio Google.
// --------------------------------------------------------------------------
export async function verifyUser(req) {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new HttpError(401, 'Faça login de novo.');
  const key = firebaseApiKey();
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(key), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: m[1] }),
  });
  const d = await r.json().catch(() => ({}));
  const u = d.users && d.users[0];
  if (!r.ok || !u || !u.localId) throw new HttpError(401, 'Sessão expirada. Faça login de novo.');
  const email = String(u.email || '').toLowerCase();
  return {
    uid: u.localId, email, emailVerified: !!u.emailVerified,
    name: u.displayName || '', createdAt: u.createdAt ? new Date(Number(u.createdAt)) : new Date(),
    isAdmin: !!email && !!u.emailVerified && cfg().admins.includes(email),
  };
}

// --------------------------------------------------------------------------
// Firestore como servidor (passa por cima das regras — só o servidor grava a assinatura).
// --------------------------------------------------------------------------
let tokenCache = null;
function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new HttpError(500, 'Servidor sem FIREBASE_SERVICE_ACCOUNT configurado.');
  let sa;
  try { sa = JSON.parse(raw); } catch (e) { throw new HttpError(500, 'FIREBASE_SERVICE_ACCOUNT não é um JSON válido.'); }
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw new HttpError(500, 'FIREBASE_SERVICE_ACCOUNT incompleto.');
  return sa;
}
const b64url = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
export function signJwt(sa, now = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(sa.private_key);
  return head + '.' + body + '.' + b64url(sig);
}
async function googleToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const sa = serviceAccount();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(sa) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new HttpError(500, 'Não consegui autenticar no Firebase (confira a conta de serviço).');
  tokenCache = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

export function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
  return { stringValue: String(v) };
}
export function fromFs(f) {
  if (!f) return undefined;
  if ('nullValue' in f) return null;
  if ('timestampValue' in f) return new Date(f.timestampValue);
  if ('booleanValue' in f) return f.booleanValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return Number(f.doubleValue);
  if ('stringValue' in f) return f.stringValue;
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(fromFs);
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return undefined;
}
const docUrl = path => 'https://firestore.googleapis.com/v1/projects/' + serviceAccount().project_id + '/databases/(default)/documents/' + path;

export async function fsGet(path) {
  const r = await fetch(docUrl(path), { headers: { authorization: 'Bearer ' + await googleToken() } });
  if (r.status === 404) return null;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(500, 'Erro ao ler o banco (' + r.status + ').');
  return Object.fromEntries(Object.entries(d.fields || {}).map(([k, x]) => [k, fromFs(x)]));
}
// Grava só os campos informados (merge).
export async function fsMerge(path, obj) {
  const qs = Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fetch(docUrl(path) + '?' + qs, {
    method: 'PATCH', headers: { authorization: 'Bearer ' + await googleToken(), 'content-type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toFs(v)])) }),
  });
  if (!r.ok) throw new HttpError(500, 'Erro ao gravar no banco (' + r.status + ').');
}

// Documentos de uma coleção com um campo de data dentro de [de, até). Usa o índice automático do campo.
export async function fsRange(collection, field, from, to, limit = 300) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + serviceAccount().project_id + '/databases/(default)/documents:runQuery';
  const where = { compositeFilter: { op: 'AND', filters: [
    { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: toFs(new Date(from)) } },
    { fieldFilter: { field: { fieldPath: field }, op: 'LESS_THAN', value: toFs(new Date(to)) } },
  ] } };
  const r = await fetch(url, {
    method: 'POST', headers: { authorization: 'Bearer ' + await googleToken(), 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where, limit } }),
  });
  const d = await r.json().catch(() => []);
  if (!r.ok) throw new HttpError(500, 'Erro ao consultar o banco (' + r.status + ').');
  return (Array.isArray(d) ? d : []).filter(x => x && x.document).map(x => ({
    id: String(x.document.name).split('/').pop(),
    d: Object.fromEntries(Object.entries(x.document.fields || {}).map(([k, v]) => [k, fromFs(v)])),
  }));
}

// Links dos e-mails (responder o porquê, parar de receber): assinados para ninguém mexer na conta de outra pessoa.
function linkKey() {
  if (process.env.LINK_SECRET) return String(process.env.LINK_SECRET);
  return crypto.createHash('sha256').update('autograna-links:' + serviceAccount().private_key).digest('hex');
}
export const linkSig = uid => crypto.createHmac('sha256', linkKey()).update('mail:' + uid).digest('hex').slice(0, 32);
export function validLinkSig(uid, sig) {
  if (!uid || !sig || !/^[A-Za-z0-9]{10,64}$/.test(uid)) return false;
  const a = Buffer.from(linkSig(uid)), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --------------------------------------------------------------------------
// Mercado Pago
// --------------------------------------------------------------------------
export async function mp(method, path, body, idemKey) {
  const tok = process.env.MP_ACCESS_TOKEN;
  if (!tok) throw new HttpError(500, 'Servidor sem MP_ACCESS_TOKEN configurado.');
  const headers = { authorization: 'Bearer ' + tok, 'content-type': 'application/json' };
  // A mesma chave faz o Mercado Pago devolver o mesmo resultado se o pedido for repetido (nada em dobro).
  if (method === 'POST') headers['x-idempotency-key'] = idemKey || crypto.randomUUID();
  const r = await fetch('https://api.mercadopago.com' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (d && (d.message || (d.cause && d.cause[0] && d.cause[0].description))) || ('HTTP ' + r.status);
    throw new HttpError(r.status >= 500 ? 502 : 400, 'Mercado Pago: ' + msg, r.status);
  }
  return d;
}

// Confere a assinatura (x-signature) das notificações do Mercado Pago.
// manifesto: id:[data.id];request-id:[x-request-id];ts:[ts];
export function validMpSignature({ signature, requestId, dataId, secret }) {
  if (!secret) return false; // sem segredo configurado, nenhum aviso é aceito (o app confere sozinho ao abrir)
  if (!signature || !dataId) return false;
  const parts = Object.fromEntries(String(signature).split(',').map(p => p.split('=').map(s => s.trim())));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : String(dataId);
  let manifest = 'id:' + id + ';';
  if (requestId) manifest += 'request-id:' + requestId + ';';
  manifest += 'ts:' + parts.ts + ';';
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(parts.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --------------------------------------------------------------------------
// Regras de acesso (teste grátis, assinatura ativa, cancelada…)
// O acesso pago vem SÓ de cobranças aprovadas: cada uma libera 1 mês (+3 dias de folga
// enquanto o Mercado Pago tenta cobrar de novo um cartão recusado).
// --------------------------------------------------------------------------
const maxDate = (...ds) => { const v = ds.filter(Boolean).map(d => +new Date(d)).filter(n => !isNaN(n)); return v.length ? new Date(Math.max(...v)) : null; };
const plusMonth = d => { const x = new Date(d); const day = x.getUTCDate(); x.setUTCMonth(x.getUTCMonth() + 1); if (x.getUTCDate() < day) x.setUTCDate(0); return x; };
const PROVISIONAL_DAYS = 2;

// Teste grátis amarrado ao e-mail (não à conta): apagar a conta e entrar de novo não dá outro teste.
export function normEmail(e) {
  let [local = '', domain = ''] = String(e || '').trim().toLowerCase().split('@');
  local = local.split('+')[0];
  if (domain === 'gmail.com' || domain === 'googlemail.com') { local = local.replace(/\./g, ''); domain = 'gmail.com'; }
  return local && domain ? local + '@' + domain : '';
}
export const trialKey = e => { const n = normEmail(e); return n ? crypto.createHash('sha256').update(n).digest('hex') : ''; };

export function newBilling(user, now = new Date(), trialEnd = null) {
  const c = cfg();
  const te = trialEnd ? new Date(trialEnd) : new Date(+now + c.trialDays * DAY);
  return { email: user.email || '', name: user.name || '', createdAt: now, trialEnd: te, accessUntil: te,
    status: +te > +now ? 'trial' : 'expired', amount: c.price, updatedAt: now };
}

// Recalcula o acesso a partir da assinatura e das cobranças APROVADAS no Mercado Pago.
export function applyPreapproval(billing, pre, payments = [], now = new Date()) {
  const c = cfg();
  const out = { mpStatus: pre.status || '', preapprovalId: pre.id || billing.preapprovalId || '', updatedAt: now };
  if (pre.payer_email) out.payerEmail = String(pre.payer_email).toLowerCase();
  const amount = pre.auto_recurring && pre.auto_recurring.transaction_amount;
  if (amount) out.amount = Number(amount);
  if (pre.next_payment_date) out.nextPayment = new Date(pre.next_payment_date);
  let paidUntil = billing.paidUntil ? new Date(billing.paidUntil) : null;
  for (const p of payments || []) {
    if (!p || !p.payment || p.payment.status !== 'approved') continue;
    if (p.preapproval_id && pre.id && p.preapproval_id !== pre.id) continue;
    paidUntil = maxDate(paidUntil, plusMonth(p.debit_date || p.date_created || now));
  }
  if (paidUntil) out.paidUntil = paidUntil;
  const trialEnd = billing.trialEnd ? new Date(billing.trialEnd) : null;
  const paidOk = paidUntil && now < paidUntil;
  const pixUntil = billing.pixUntil ? new Date(billing.pixUntil) : null;
  const pixOn = pixUntil && now < pixUntil;
  if (pre.status === 'authorized') {
    // Entre autorizar o cartão e a 1ª cobrança (~1 h) a pessoa não fica travada: libera até 2 dias,
    // uma vez por assinatura — e não de novo se a liberação anterior terminou sem nenhuma cobrança aprovada.
    const approvedThis = (payments || []).some(p => p && p.payment && p.payment.status === 'approved' && (!p.preapproval_id || p.preapproval_id === pre.id));
    const provForThis = billing.provisionalFor === pre.id;
    let prov = provForThis && billing.provisionalUntil ? new Date(billing.provisionalUntil) : null;
    if (approvedThis && provForThis) out.provisionalPaid = true;
    const lastProvUnpaid = billing.provisionalFor && !provForThis && !billing.provisionalPaid;
    if (!approvedThis && !prov && !lastProvUnpaid && !paidOk && !pixOn && !(trialEnd && now < trialEnd)) {
      prov = new Date(+now + PROVISIONAL_DAYS * DAY);
      out.provisionalFor = pre.id; out.provisionalUntil = prov; out.provisionalPaid = false;
    }
    out.accessUntil = maxDate(trialEnd, paidUntil ? new Date(+paidUntil + c.graceDays * DAY) : null, prov, pixUntil) || now;
    out.status = paidOk ? 'active' : (trialEnd && now < trialEnd) ? 'trial' : pixOn ? 'active' : (prov && now < prov) ? 'awaiting' : (paidUntil && now < new Date(+paidUntil + c.graceDays * DAY)) ? 'retrying' : 'expired';
  } else {
    out.accessUntil = maxDate(trialEnd, paidUntil, pixUntil) || now;
    out.status = (pre.status === 'cancelled' || pre.status === 'paused') ? pre.status : (paidOk ? 'active' : (trialEnd && now < trialEnd) ? 'trial' : pixOn ? 'active' : 'expired');
  }
  return out;
}

// Evita que um aviso de uma assinatura antiga (ex.: um checkout abandonado) apague a atual.
export function shouldApply(billing, pre) {
  if (!pre || !pre.id) return false;
  if (!billing.preapprovalId || billing.preapprovalId === pre.id) return true;
  return pre.status === 'authorized' && billing.mpStatus !== 'authorized';
}

// Lê a assinatura e as cobranças no Mercado Pago e atualiza billing/{uid}.
// Também cancela assinaturas duplicadas para ninguém ser cobrado duas vezes.
export async function refreshFromMp(uid, b, preId, extraPayment = null) {
  const pre = await mp('GET', '/preapproval/' + encodeURIComponent(preId));
  if (String(pre.external_reference || '') !== uid) return { b, ignored: 'outra pessoa' };
  if (b.preapprovalId && b.preapprovalId !== pre.id && pre.status === 'authorized' && b.mpStatus === 'authorized') {
    try { await mp('PUT', '/preapproval/' + encodeURIComponent(pre.id), { status: 'cancelled' }); } catch (e) { console.error('[dup-cancel]', e.message); }
    return { b, ignored: 'duplicada cancelada' };
  }
  if (!shouldApply(b, pre)) return { b, ignored: 'assinatura antiga' };
  if (b.preapprovalId && b.preapprovalId !== pre.id && b.mpStatus === 'pending') {
    try { await mp('PUT', '/preapproval/' + encodeURIComponent(b.preapprovalId), { status: 'cancelled' }); } catch (e) { /* link antigo já pode ter expirado */ }
  }
  let payments = [];
  try {
    const q = '/authorized_payments/search?preapproval_id=' + encodeURIComponent(pre.id) + '&limit=50';
    const r = await mp('GET', q + '&offset=0');
    payments = (r && r.results) || [];
    const total = r && r.paging && r.paging.total;
    if (total > payments.length) { const last = await mp('GET', q + '&offset=' + Math.max(0, total - 50)); payments = payments.concat((last && last.results) || []); }
  } catch (e) { console.warn('[payments-search]', e.message); }
  if (extraPayment) payments.push(extraPayment);
  const patch = applyPreapproval(b, pre, payments);
  patch.lastSync = new Date();
  if (extraPayment) {
    patch.lastPaymentStatus = String((extraPayment.payment && extraPayment.payment.status) || extraPayment.status || '');
    patch.lastPaymentAmount = Number(extraPayment.transaction_amount || 0);
    patch.lastPaymentDate = new Date(extraPayment.debit_date || Date.now());
  }
  await fsMerge('billing/' + uid, patch);
  return { b: Object.assign({}, b, patch) };
}

// O que o app recebe sobre a assinatura.
export function publicView(b, user, now = new Date()) {
  const c = cfg();
  const access = !!user.isAdmin || !!(b.accessUntil && now < new Date(b.accessUntil));
  let status = b.status || 'trial';
  const trialOn = b.trialEnd && now < new Date(b.trialEnd);
  const paidOn = b.paidUntil && now < new Date(b.paidUntil);
  const pixOn = b.pixUntil && now < new Date(b.pixUntil);
  if (paidOn && b.mpStatus === 'authorized') status = 'active';
  else if (pixOn && !trialOn) status = 'active';
  else if (status === 'trial' && !trialOn) status = access ? status : 'expired';
  if (!access && status !== 'cancelled' && status !== 'paused') status = 'expired';
  return {
    access, isAdmin: !!user.isAdmin, status,
    trialEnd: b.trialEnd ? new Date(b.trialEnd).toISOString() : null,
    accessUntil: b.accessUntil ? new Date(b.accessUntil).toISOString() : null,
    paidUntil: b.paidUntil ? new Date(b.paidUntil).toISOString() : null,
    payerEmail: b.payerEmail || '', mpStatus: b.mpStatus || '', price: c.price,
    trialDays: c.trialDays,
    // Como a pessoa paga hoje: 'card' (renova sozinho), 'pix' (mês a mês) ou '' (ainda não paga).
    method: b.mpStatus === 'authorized' ? 'card' : pixOn ? 'pix' : '',
    pixUntil: b.pixUntil ? new Date(b.pixUntil).toISOString() : null,
    pixPending: !!(b.pixPending && b.pixPending.id),
    // Cartão digitado dentro do app (campos seguros do Mercado Pago). Sem chave, o app usa o site do Mercado Pago.
    publicKey: c.publicKey,
    cardBrand: b.mpStatus === 'authorized' ? (b.cardBrand || '') : '',
    cardLast4: b.mpStatus === 'authorized' ? (b.cardLast4 || '') : '',
    nextPayment: b.mpStatus === 'authorized' && b.nextPayment ? new Date(b.nextPayment).toISOString() : null,
  };
}

// --------------------------------------------------------------------------
// Pix: cada pagamento aprovado libera 1 mês, sem renovação automática.
// O código é criado pelo servidor com external_reference "pix1m:<uid>"; é isso que separa
// um Pix do app de qualquer outro pagamento da conta (inclusive as cobranças do cartão).
// --------------------------------------------------------------------------
export const PIX_REF = 'pix1m:';
export const pixRefFor = uid => PIX_REF + uid;
export const uidFromPixRef = ref => { const s = String(ref || ''); return s.startsWith(PIX_REF) ? s.slice(PIX_REF.length) : ''; };

// Recebe o pagamento lido na API do Mercado Pago e devolve o que gravar (ou null se não há nada a fazer).
export function applyPix(b, pay, now = new Date()) {
  if (!pay || pay.status !== 'approved' || String(pay.payment_method_id || '') !== 'pix') return null;
  const id = String(pay.id || '');
  if (!id) return null;
  const done = Array.isArray(b.pixPaidIds) ? b.pixPaidIds.map(String) : [];
  if (done.includes(id)) return null; // já contado (aviso repetido ou conferência dupla)
  const paidAt = pay.date_approved ? new Date(pay.date_approved) : now;
  const ahead = d => (d && +new Date(d) > +paidAt) ? new Date(d) : null;
  // O mês pago começa quando acaba o que a pessoa já tem: teste, mês do cartão ou outro Pix.
  const base = maxDate(paidAt, ahead(b.trialEnd), ahead(b.pixUntil), ahead(b.paidUntil));
  const pixUntil = plusMonth(base);
  const trialOn = b.trialEnd && now < new Date(b.trialEnd);
  const pend = b.pixPending && String(b.pixPending.id) === id;
  const patch = {
    pixUntil, accessUntil: maxDate(b.accessUntil, pixUntil),
    pixPaidIds: done.concat(id).slice(-24),
    status: trialOn ? 'trial' : 'active',
    lastPaymentStatus: 'approved', lastPaymentMethod: 'pix',
    lastPaymentAmount: Number(pay.transaction_amount || 0), lastPaymentDate: paidAt, updatedAt: now,
  };
  if (pend || !b.pixPending) patch.pixPending = null;
  if (pay.transaction_amount) patch.amount = Number(pay.transaction_amount);
  return patch;
}

// Pix pendente que ainda pode ser pago (com folga de 10 minutos antes de vencer).
export function pixStillValid(p, price, now = new Date()) {
  return !!(p && p.id && p.qr && p.expires && +new Date(p.expires) - +now > 10 * 60000 && Math.abs(Number(p.amount) - price) < 0.005);
}
