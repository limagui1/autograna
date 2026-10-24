// Recebe os avisos do Mercado Pago (assinatura criada/alterada, cada cobrança mensal do cartão e os pagamentos Pix).
// Endereço para colar no Mercado Pago: https://SEU-SITE/.netlify/functions/mp-webhook
// Segurança: só aceita avisos com assinatura válida (MP_WEBHOOK_SECRET) e, mesmo assim, relê tudo
// direto na API do Mercado Pago antes de liberar ou bloquear alguém.
import { json, HttpError, fsGet, fsMerge, mp, newBilling, refreshFromMp, validMpSignature, applyPix, uidFromPixRef } from '../lib/core.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(200, { ok: true });
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const type = String(body.type || body.topic || url.searchParams.get('type') || url.searchParams.get('topic') || '');
  const dataId = String((body.data && body.data.id) || url.searchParams.get('data.id') || url.searchParams.get('id') || '');

  if (!process.env.MP_WEBHOOK_SECRET) {
    console.warn('[mp-webhook] MP_WEBHOOK_SECRET não configurado — aviso ignorado (o app confere o pagamento ao abrir).');
    return json(200, { ignored: 'sem segredo' });
  }
  if (!validMpSignature({
    signature: req.headers.get('x-signature'), requestId: req.headers.get('x-request-id'),
    dataId: url.searchParams.get('data.id') || dataId, secret: process.env.MP_WEBHOOK_SECRET,
  })) {
    console.warn('[mp-webhook] assinatura inválida', type, dataId);
    return json(401, { error: 'assinatura inválida' });
  }
  if (!dataId) return json(200, { ignored: true });

  try {
    // Pix do app (um pagamento avulso que libera 1 mês). Outros pagamentos da conta são ignorados.
    if (type === 'payment') {
      const pay = await mp('GET', '/v1/payments/' + encodeURIComponent(dataId));
      const uid = uidFromPixRef(pay.external_reference);
      if (!uid) return json(200, { ignored: 'não é Pix do app' });
      if (!/^[A-Za-z0-9]{10,64}$/.test(uid)) return json(200, { ignored: 'sem usuário' });
      const path = 'billing/' + uid;
      const b = await fsGet(path);
      if (!b) return json(200, { ignored: 'sem cadastro' });
      const patch = applyPix(b, pay);
      if (!patch) return json(200, { ignored: String(pay.status || 'sem mudança') });
      await fsMerge(path, patch);
      return json(200, { ok: true });
    }

    let preId = null, payment = null;
    if (type.includes('preapproval') && !type.includes('plan')) preId = dataId;
    else if (type.includes('authorized_payment')) {
      payment = await mp('GET', '/authorized_payments/' + encodeURIComponent(dataId));
      preId = payment.preapproval_id;
    } else return json(200, { ignored: type });
    if (!preId) return json(200, { ignored: 'sem assinatura' });

    const pre = await mp('GET', '/preapproval/' + encodeURIComponent(preId));
    const uid = String(pre.external_reference || '');
    if (!/^[A-Za-z0-9]{10,64}$/.test(uid)) return json(200, { ignored: 'sem usuário' });

    const path = 'billing/' + uid;
    let b = await fsGet(path);
    if (!b) { b = newBilling({ email: String(pre.payer_email || ''), name: '' }); await fsMerge(path, b); }
    const r = await refreshFromMp(uid, b, preId, payment);
    return json(200, r.ignored ? { ignored: r.ignored } : { ok: true });
  } catch (e) {
    // Só descarta quando o ID não existe no Mercado Pago (ex.: aviso de teste do painel).
    // Token vencido (401), excesso de chamadas (429) etc. → 500, para o Mercado Pago reenviar.
    if (e instanceof HttpError && e.upstream === 404) { console.warn('[mp-webhook]', e.message); return json(200, { ignored: e.message }); }
    console.error('[mp-webhook]', e);
    return json(500, { error: 'tente de novo' }); // o Mercado Pago reenvia mais tarde
  }
};
