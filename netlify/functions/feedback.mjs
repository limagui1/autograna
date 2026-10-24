// Respostas dos e-mails: o porquê de não assinar e o "não quero mais receber".
// A página /obrigado é quem grava (via POST), depois que a pessoa abre o link — assim os robôs
// antivírus que "clicam" nos links do e-mail não respondem nem descadastram ninguém por engano.
//
// POST /.netlify/functions/feedback   { u, s, r? , comment?, a? }   (a = 'sair' → parar de receber e-mails)
// POST /.netlify/functions/feedback?a=sair&u=…&s=…   (botão "Cancelar inscrição" do Gmail, em um clique)
// GET  /.netlify/functions/feedback?…   → leva para a página /obrigado
import { json, fsGet, fsMerge, validLinkSig } from '../lib/core.mjs';
import { REASONS } from '../lib/email.mjs';

const optOut = uid => fsMerge('billing/' + uid, { emailOptOut: true, emailOptOutAt: new Date() });

export default async (req) => {
  const url = new URL(req.url), q = url.searchParams;
  try {
    if (req.method === 'GET') {
      const to = '/obrigado?' + (q.get('a') === 'sair' ? 'sair=1&' : '') + 'u=' + encodeURIComponent(q.get('u') || '') + '&s=' + encodeURIComponent(q.get('s') || '');
      return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } });
    }
    if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

    // "Cancelar inscrição" de um clique (RFC 8058): o provedor de e-mail manda os dados na URL.
    if (q.get('a') === 'sair') {
      const u = q.get('u') || '', s = q.get('s') || '';
      if (!validLinkSig(u, s)) return json(403, { error: 'Link inválido.' });
      await optOut(u);
      return json(200, { ok: true });
    }

    const body = await req.json().catch(() => ({}));
    const u = String(body.u || ''), s = String(body.s || '');
    if (!validLinkSig(u, s)) return json(403, { error: 'Esse link não vale mais. Abra de novo pelo e-mail.' });
    if (body.a === 'sair') { await optOut(u); return json(200, { ok: true, sair: true }); }

    const patch = {};
    const r = String(body.r || '');
    if (r) {
      if (!REASONS[r]) return json(400, { error: 'Resposta desconhecida.' });
      const b = (await fsGet('billing/' + u)) || {};
      Object.assign(patch, { reason: r, reasonLabel: REASONS[r], at: new Date(), email: b.email || '', name: b.name || '' });
      if (b.trialEnd) patch.trialEnd = new Date(b.trialEnd);
    }
    const comment = String(body.comment || '').replace(/\s+$/g, '').slice(0, 1500).trim();
    if (comment) Object.assign(patch, { comment, commentAt: new Date() });
    if (!Object.keys(patch).length) return json(400, { error: 'Nada para salvar.' });
    await fsMerge('feedback/' + u, patch);
    return json(200, { ok: true });
  } catch (e) {
    console.error('[feedback]', e);
    return json(500, { error: 'Não deu pra salvar agora. Tente de novo em instantes.' });
  }
};
