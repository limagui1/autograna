// Assinatura do usuário logado: consultar, cadastrar/trocar o cartão, pagar com Pix, conferir pagamento e cancelar.
// POST /.netlify/functions/billing  { action: 'status' | 'card' | 'subscribe' | 'sync' | 'cancel' | 'pix' | 'pixCheck', ... }
//   card:      { token, brand?, last4? } — cartão digitado no app (campos seguros do Mercado Pago). Não precisa de conta no Mercado Pago.
//   subscribe: { payerEmail } — alternativa pelo site do Mercado Pago (só usada se MP_PUBLIC_KEY não estiver configurada).
import crypto from 'node:crypto';
import { cfg, json, HttpError, verifyUser, fsGet, fsMerge, mp, newBilling, applyPreapproval, publicView, refreshFromMp, trialKey,
  applyPix, pixRefFor, uidFromPixRef, pixStillValid, siteUrl } from '../lib/core.mjs';
import { mailConfigured, sendMail, tplTrialEnding, tplFirstCharge, tplTrialEnded } from '../lib/email.mjs';
import { linksFor } from '../lib/emails-job.mjs';

const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Erro do Mercado Pago ao cadastrar o cartão → mensagem que a pessoa entende (o detalhe vai para o log).
function cardError(e) {
  if (!(e instanceof HttpError) || !e.upstream) return e;   // falta de configuração etc.: mantém a mensagem
  if (e.upstream >= 500 || e.upstream === 429) return new HttpError(502, 'O Mercado Pago não respondeu agora. Tente de novo em instantes.');
  if (e.upstream === 401 || e.upstream === 403) { console.error('[billing:card] credenciais', e.message); return new HttpError(500, 'Pagamento indisponível agora (credenciais do Mercado Pago).'); }
  console.warn('[billing:card]', e.message);
  const m = String(e.message || '').toLowerCase();
  if (/token/.test(m)) return new HttpError(400, 'Os dados do cartão expiraram. Digite de novo e tente outra vez.');
  if (/insufficient|saldo|amount/.test(m)) return new HttpError(400, 'O cartão não tem limite disponível para a conferência. Tente outro cartão.');
  if (/payer|email/.test(m) && /test|same|collector|seller/.test(m)) return new HttpError(400, 'Esse cartão/conta não pode assinar (no modo de teste, use um comprador de teste).');
  return new HttpError(400, 'O cartão não foi aceito pelo Mercado Pago. Confira os dados ou use outro cartão.');
}

async function loadOrCreate(user) {
  const path = 'billing/' + user.uid;
  let b = await fsGet(path);
  if (b) return b;
  // O teste grátis é do e-mail, não da conta: quem apaga a conta e volta não ganha outro.
  // Só e-mails verificados (Google, ou e-mail confirmado) usam o registro por e-mail — assim ninguém
  // "gasta" o teste de outra pessoa criando conta com o e-mail dela.
  const key = user.emailVerified ? trialKey(user.email) : '';
  let trialEnd = null;
  if (key) {
    const t = await fsGet('trials/' + key);
    if (t && t.trialEnd) trialEnd = t.trialEnd;
  }
  b = newBilling(user, new Date(), trialEnd);
  if (key && !trialEnd) await fsMerge('trials/' + key, { trialEnd: b.trialEnd, firstUid: user.uid, createdAt: new Date() });
  await fsMerge(path, b);
  return b;
}

async function sync(user, b) {
  if (!b.preapprovalId) return b;
  return (await refreshFromMp(user.uid, b, b.preapprovalId)).b;
}

// Confere no Mercado Pago o Pix que está em aberto. Pago → libera 1 mês; vencido/cancelado → descarta.
async function checkPix(user, b) {
  const pend = b.pixPending;
  if (!pend || !pend.id) return b;
  const pay = await mp('GET', '/v1/payments/' + encodeURIComponent(pend.id));
  if (uidFromPixRef(pay.external_reference) !== user.uid) return b;
  if (pay.status === 'approved') {
    const patch = applyPix(b, pay);
    if (!patch) return b;
    await fsMerge('billing/' + user.uid, patch);
    return Object.assign({}, b, patch);
  }
  const dead = ['cancelled', 'rejected', 'refunded', 'charged_back'].includes(pay.status);
  if (dead || (pend.expires && Date.now() > +new Date(pend.expires) + 3600000)) {
    await fsMerge('billing/' + user.uid, { pixPending: null });
    return Object.assign({}, b, { pixPending: null });
  }
  return b;
}
const pixOut = p => ({ id: String(p.id), qr: p.qr, qrB64: p.qrB64 || '', ticket: p.ticket || '', amount: Number(p.amount), expires: new Date(p.expires).toISOString() });

export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
    const user = await verifyUser(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'status';
    let b = await loadOrCreate(user);

    if (action === 'status') {
      // Confere no Mercado Pago no máximo a cada 2 minutos (pega renovações mesmo sem webhook).
      const stale = !b.lastSync || (Date.now() - new Date(b.lastSync)) > 120000;
      if (b.preapprovalId && b.mpStatus !== 'cancelled' && stale) { try { b = await sync(user, b); } catch (e) { console.warn('[billing:status]', e.message); } }
      // Pix em aberto: confere ao abrir o app (pega o pagamento mesmo se o aviso do Mercado Pago falhar).
      if (b.pixPending && b.pixPending.id) { try { b = await checkPix(user, b); } catch (e) { console.warn('[billing:pix-status]', e.message); } }
      return json(200, publicView(b, user));
    }

    if (action === 'sync') {
      if (b.pixPending && b.pixPending.id) { try { b = await checkPix(user, b); } catch (e) { console.warn('[billing:pix-sync]', e.message); } }
      b = await sync(user, b);
      return json(200, publicView(b, user));
    }

    if (action === 'pix') {
      const c = cfg();
      if (b.preapprovalId && b.mpStatus === 'authorized') {
        try { b = await sync(user, b); } catch (e) { /* segue com o que tem */ }
        if (b.mpStatus === 'authorized') throw new HttpError(400, 'Sua assinatura no cartão já está ativa. Para pagar no Pix, cancele a do cartão em Ajustes › Assinatura.');
      }
      const pendId = b.pixPending && b.pixPending.id ? String(b.pixPending.id) : '';
      try { b = await checkPix(user, b); } catch (e) { console.warn('[billing:pix-reuse]', e.message); }
      // O código anterior acabou de ser pago: avisa em vez de gerar outro.
      if (pendId && Array.isArray(b.pixPaidIds) && b.pixPaidIds.map(String).includes(pendId)) return json(200, Object.assign(publicView(b, user), { paid: true }));
      // Um código por vez: se o anterior ainda vale, devolve o mesmo (nada de pagar duas vezes sem querer).
      if (pixStillValid(b.pixPending, c.price)) return json(200, Object.assign(publicView(b, user), { pix: pixOut(b.pixPending) }));
      if (!user.email) throw new HttpError(400, 'Sua conta precisa de um e-mail para pagar com Pix.');
      const pay = await mp('POST', '/v1/payments', {
        transaction_amount: c.price,
        description: 'Autograna — 1 mês de acesso',
        payment_method_id: 'pix',
        external_reference: pixRefFor(user.uid),
        payer: Object.assign({ email: user.email }, user.name ? { first_name: String(user.name).split(' ')[0].slice(0, 60) } : {}),
      });
      const td = (pay.point_of_interaction && pay.point_of_interaction.transaction_data) || {};
      if (!pay.id || !td.qr_code) throw new HttpError(502, 'O Mercado Pago não devolveu o código Pix. Tente de novo.');
      const pend = { id: String(pay.id), qr: td.qr_code, qrB64: td.qr_code_base64 || '', ticket: td.ticket_url || '', amount: c.price,
        expires: pay.date_of_expiration ? new Date(pay.date_of_expiration) : new Date(Date.now() + 86400000), createdAt: new Date() };
      await fsMerge('billing/' + user.uid, { pixPending: pend, updatedAt: new Date() });
      b = Object.assign({}, b, { pixPending: pend });
      return json(200, Object.assign(publicView(b, user), { pix: pixOut(pend) }));
    }

    if (action === 'pixCheck') {
      try { b = await checkPix(user, b); } catch (e) { console.warn('[billing:pixCheck]', e.message); }
      const id = String(body.id || '');
      const paid = !!id && Array.isArray(b.pixPaidIds) && b.pixPaidIds.map(String).includes(id);
      return json(200, Object.assign(publicView(b, user), { paid }));
    }

    if (action === 'card') {
      const token = String(body.token || '').trim();
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) throw new HttpError(400, 'Não consegui ler o cartão. Digite os dados de novo.');
      if (!user.email) throw new HttpError(400, 'Sua conta precisa de um e-mail para assinar.');
      const card = { cardBrand: String(body.brand || '').replace(/[^a-z0-9_ -]/gi, '').slice(0, 24), cardLast4: String(body.last4 || '').replace(/\D/g, '').slice(-4) };
      const c = cfg();
      // Relê na hora: se outro pedido acabou de cadastrar um cartão (toque duplo, duas abas), vira troca de cartão.
      try { const fresh = await fsGet('billing/' + user.uid); if (fresh) b = fresh; } catch (e) { /* segue com o que tem */ }
      // Já tem cartão ativo: troca o cartão da mesma assinatura (vale para a próxima cobrança e para as novas tentativas).
      if (b.preapprovalId && b.mpStatus === 'authorized') {
        try { await mp('PUT', '/preapproval/' + encodeURIComponent(b.preapprovalId), { card_token_id: token }); }
        catch (e) { throw cardError(e); }
        await fsMerge('billing/' + user.uid, Object.assign({ updatedAt: new Date() }, card));
        b = Object.assign({}, b, card);
        try { b = await sync(user, b); } catch (e) { console.warn('[billing:card-swap-sync]', e.message); }
        return json(200, Object.assign(publicView(b, user), { swapped: true }));
      }
      // Link do site do Mercado Pago que ficou aberto: cancela para não existir cobrança em dobro.
      if (b.preapprovalId && b.mpStatus === 'pending') {
        try { await mp('PUT', '/preapproval/' + encodeURIComponent(b.preapprovalId), { status: 'cancelled' }); } catch (e) { /* já expirado */ }
      }
      const auto = { frequency: 1, frequency_type: 'months', transaction_amount: c.price, currency_id: 'BRL' };
      // No teste (ou com mês pago sobrando), nada é cobrado agora: a 1ª cobrança é quando esse período acabar.
      const until = b.accessUntil ? new Date(b.accessUntil) : null;
      if (until && +until > Date.now() + 15 * 60000) auto.start_date = until.toISOString();
      let pre;
      try {
        pre = await mp('POST', '/preapproval', {
          reason: 'Autograna — assinatura mensal',
          external_reference: user.uid,
          payer_email: user.email,
          card_token_id: token,
          auto_recurring: auto,
          back_url: siteUrl() + '/app',
          status: 'authorized',
        }, 'card-' + crypto.createHash('sha256').update(user.uid + ':' + token).digest('hex').slice(0, 40));
      } catch (e) { throw cardError(e); }
      if (!pre || !pre.id) throw new HttpError(502, 'O Mercado Pago não confirmou o cartão. Tente de novo.');
      if (pre.status !== 'authorized') {
        try { await mp('PUT', '/preapproval/' + encodeURIComponent(pre.id), { status: 'cancelled' }); } catch (e) { /* segue */ }
        throw new HttpError(400, 'O cartão não foi aprovado. Confira os dados ou use outro cartão.');
      }
      const patch = Object.assign({ preapprovalId: pre.id, mpStatus: 'authorized', payerEmail: user.email, initPoint: '', amount: c.price, cardAt: new Date(), updatedAt: new Date() }, card);
      await fsMerge('billing/' + user.uid, patch);
      b = Object.assign({}, b, patch);
      b = (await refreshFromMp(user.uid, b, pre.id)).b;
      return json(200, Object.assign(publicView(b, user), { cardSaved: true }));
    }

    if (action === 'subscribe') {
      if (b.preapprovalId && b.mpStatus === 'authorized') {
        try { b = await sync(user, b); } catch (e) { /* segue */ }
        if (b.mpStatus === 'authorized') return json(200, Object.assign(publicView(b, user), { already: true }));
      }
      const payerEmail = String(body.payerEmail || user.email || '').trim().toLowerCase();
      if (!validEmail(payerEmail)) throw new HttpError(400, 'Informe o e-mail da sua conta Mercado Pago.');
      // Um link de pagamento por vez: o anterior (não pago) é cancelado para não haver cobrança em dobro.
      if (b.preapprovalId && b.mpStatus === 'pending') {
        try { await mp('PUT', '/preapproval/' + encodeURIComponent(b.preapprovalId), { status: 'cancelled' }); } catch (e) { /* já expirado */ }
      }
      const site = process.env.URL || ('https://' + (req.headers.get('host') || ''));
      const c = cfg();
      const auto = { frequency: 1, frequency_type: 'months', transaction_amount: c.price, currency_id: 'BRL' };
      // Quem assina ainda no teste (ou com mês pago sobrando) só é cobrado quando esse período acabar.
      const until = b.accessUntil ? new Date(b.accessUntil) : null;
      if (until && +until > Date.now() + 15 * 60000) auto.start_date = until.toISOString();
      const pre = await mp('POST', '/preapproval', {
        reason: 'Autograna — assinatura mensal',
        external_reference: user.uid,
        payer_email: payerEmail,
        auto_recurring: auto,
        back_url: site.replace(/\/$/, '') + '/app?assinatura=retorno',
        status: 'pending',
      });
      if (!pre.init_point) throw new HttpError(502, 'O Mercado Pago não devolveu o link de pagamento.');
      await fsMerge('billing/' + user.uid, { preapprovalId: pre.id, mpStatus: pre.status || 'pending', payerEmail, initPoint: pre.init_point, amount: c.price, updatedAt: new Date() });
      return json(200, { initPoint: pre.init_point });
    }

    if (action === 'cancel') {
      if (!b.preapprovalId) throw new HttpError(400, 'Você não tem assinatura ativa.');
      const pre = await mp('PUT', '/preapproval/' + encodeURIComponent(b.preapprovalId), { status: 'cancelled' });
      // Garante que nenhuma outra assinatura desta conta continue cobrando.
      try {
        const r = await mp('GET', '/preapproval/search?external_reference=' + encodeURIComponent(user.uid) + '&limit=50');
        for (const x of (r && r.results) || []) {
          if (String(x.external_reference) === user.uid && x.id !== b.preapprovalId && (x.status === 'authorized' || x.status === 'paused' || x.status === 'pending')) {
            try { await mp('PUT', '/preapproval/' + encodeURIComponent(x.id), { status: 'cancelled' }); } catch (e) { console.warn('[cancel-extra]', e.message); }
          }
        }
      } catch (e) { console.warn('[cancel-search]', e.message); }
      const patch = applyPreapproval(b, Object.assign({ id: b.preapprovalId }, pre, { status: 'cancelled' }), []);
      patch.lastSync = new Date();
      await fsMerge('billing/' + user.uid, patch);
      return json(200, publicView(Object.assign({}, b, patch), user));
    }

    // Só o dono: manda para o próprio e-mail os 3 avisos automáticos, para conferir se o envio está funcionando.
    if (action === 'emailTest') {
      if (!user.isAdmin) throw new HttpError(403, 'Só o dono do app pode fazer isso.');
      if (!mailConfigured()) throw new HttpError(400, 'O envio de e-mails ainda não está configurado no Netlify (SMTP_USER e SMTP_PASS).');
      const c = cfg(), site = siteUrl(), links = linksFor(user.uid), now = new Date();
      const demo = { name: user.name || 'Teste', trialEnd: new Date(+now + 20 * 3600000), cardBrand: 'visa', cardLast4: '4242' };
      for (const tpl of [tplTrialEnding, tplFirstCharge, tplTrialEnded]) {
        const m = tpl({ b: demo, site, links, price: c.price, now });
        try { await sendMail({ to: user.email, subject: '[Exemplo] ' + m.subject, html: m.html, text: m.text, unsubscribe: links.oneClick }); }
        catch (e) { console.error('[billing:emailTest]', e.message); throw new HttpError(502, 'Não consegui enviar: ' + e.message); }
      }
      return json(200, { sent: 3, to: user.email });
    }

    return json(400, { error: 'Ação desconhecida.' });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error('[billing]', e);
    return json(status, { error: e instanceof HttpError ? e.message : 'Erro inesperado. Tente de novo em instantes.' });
  }
};
