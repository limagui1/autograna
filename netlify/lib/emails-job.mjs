// Rotina dos e-mails automáticos (roda de hora em hora pela função agendada "emails-agendados").
//  1. Teste acabando (de 36 h a 12 h antes do fim):
//     - sem cartão/Pix → "Seu teste acaba amanhã" com o botão para continuar;
//     - com cartão cadastrado → lembrete da 1ª cobrança (e como cancelar).
//  2. Teste acabou sem pagar (de 1 h a 4 dias depois) → "Não quer continuar? Conta pra gente por quê".
// Cada e-mail sai uma vez por pessoa (marcado no billing/{uid}); quem pediu para sair não recebe nada.
// Só envia entre 9h e 21h (horário de Brasília) — o que cair fora disso sai na manhã seguinte.
import { cfg, fsRange, fsMerge, linkSig, siteUrl } from './core.mjs';
import { mailConfigured, sendMail, spHour, tplTrialEnding, tplFirstCharge, tplTrialEnded } from './email.mjs';

const H = 3600000;
const after = (d, now) => d && +new Date(d) > +now;

export function linksFor(uid) {
  const site = siteUrl(), q = 'u=' + encodeURIComponent(uid) + '&s=' + linkSig(uid);
  return {
    app: site + '/app',
    subscribe: site + '/app?assinar=1',
    reason: k => site + '/obrigado?r=' + encodeURIComponent(k) + '&' + q,
    unsubscribe: site + '/obrigado?sair=1&' + q,
    oneClick: site + '/.netlify/functions/feedback?a=sair&' + q,
  };
}

export async function runEmails({ now = new Date(), ignoreQuietHours = false, budgetMs = 22000, max = 60 } = {}) {
  if (!mailConfigured()) return { skipped: 'e-mail não configurado (SMTP_USER/SMTP_PASS ou RESEND_API_KEY)' };
  const h = spHour(now);
  if (!ignoreQuietHours && (h < 9 || h >= 21)) return { skipped: 'fora do horário (9h–21h)' };
  const c = cfg(), site = siteUrl(), stop = Date.now() + budgetMs;
  const out = { sent: [], failed: [] };
  const admins = new Set(c.admins);
  const send = async (uid, d, kind, tpl, mark) => {
    if (out.sent.length + out.failed.length >= max || Date.now() > stop) return;
    const links = linksFor(uid);
    const m = tpl({ b: d, site, links, price: kind === 'primeira-cobranca' ? (d.amount || c.price) : c.price, now });
    try {
      await sendMail({ to: d.email, subject: m.subject, html: m.html, text: m.text, unsubscribe: links.oneClick });
      await fsMerge('billing/' + uid, { [mark]: new Date() });
      out.sent.push(kind + ':' + uid);
    } catch (e) {
      out.failed.push(kind + ':' + uid + ' ' + e.message);
      console.error('[emails]', kind, uid, e.message);
    }
  };
  const ok = d => d && d.email && !d.emailOptOut && !admins.has(String(d.email).toLowerCase());

  // 1. teste acabando
  const soon = await fsRange('billing', 'trialEnd', +now + 12 * H, +now + 36 * H);
  for (const { id, d } of soon) {
    if (!ok(d)) continue;
    if (d.mpStatus === 'authorized') {
      if (!d.mailFirstCharge && !d.paidUntil) await send(id, d, 'primeira-cobranca', tplFirstCharge, 'mailFirstCharge');
      continue;
    }
    if (d.mailTrialEnding) continue;
    if (after(d.pixUntil, d.trialEnd) || after(d.paidUntil, now)) continue;   // já pagou o mês seguinte
    await send(id, d, 'teste-acabando', tplTrialEnding, 'mailTrialEnding');
  }

  // 2. teste acabou sem pagar
  const ended = await fsRange('billing', 'trialEnd', +now - 96 * H, +now - 1 * H);
  for (const { id, d } of ended) {
    if (!ok(d) || d.mailTrialEnded) continue;
    if (d.mpStatus === 'authorized' || after(d.accessUntil, now) || after(d.pixUntil, now) || after(d.paidUntil, now)) continue;
    await send(id, d, 'teste-acabou', tplTrialEnded, 'mailTrialEnded');
  }
  return out;
}
