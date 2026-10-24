// ==========================================================================
// E-mails do Autograna: envio (Gmail/SMTP ou Resend) e os textos de cada aviso.
// Sem dependências externas. Configure UMA das opções no Netlify:
//
//   Gmail (mais simples, sem domínio próprio):
//     SMTP_USER   seu Gmail (ex.: autograna.app@gmail.com)
//     SMTP_PASS   a "senha de app" de 16 letras gerada no Google (não é a senha normal)
//     SMTP_HOST / SMTP_PORT  (opcional; padrão smtp.gmail.com / 465)
//
//   Domínio próprio (mais profissional):
//     RESEND_API_KEY  chave do resend.com
//     EMAIL_FROM      ex.: Autograna <contato@autograna.com.br>
//
//   EMAIL_FROM_NAME (opcional) nome do remetente no Gmail (padrão "Autograna")
//   EMAIL_REPLY_TO  (opcional) para onde vão as respostas
// ==========================================================================
import crypto from 'node:crypto';
import tls from 'node:tls';

export function mailConfigured() {
  return !!(process.env.RESEND_API_KEY || (process.env.SMTP_USER && process.env.SMTP_PASS));
}

export async function sendMail({ to, subject, html, text, unsubscribe }) {
  if (!to || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error('e-mail inválido');
  const replyTo = process.env.EMAIL_REPLY_TO || '';
  if (process.env.RESEND_API_KEY) {
    const from = process.env.EMAIL_FROM;
    if (!from) throw new Error('Falta EMAIL_FROM (ex.: Autograna <contato@seudominio.com.br>)');
    const headers = unsubscribe ? { 'List-Unsubscribe': '<' + unsubscribe + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ from, to: [to], subject, html, text }, replyTo ? { reply_to: replyTo } : {}, headers ? { headers } : {})),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error('Resend ' + r.status + ': ' + (d.message || d.name || 'erro')); }
    return { via: 'resend' };
  }
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error('E-mail não configurado (SMTP_USER/SMTP_PASS ou RESEND_API_KEY).');
  const from = process.env.SMTP_FROM || user;
  const message = mime({ fromName: process.env.EMAIL_FROM_NAME || 'Autograna', from, to, subject, text, html, unsubscribe, replyTo });
  await smtp({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', port: parseInt(process.env.SMTP_PORT || '465', 10),
    user, pass: String(pass).replace(/\s+/g, ''), from, to, message, ca: process.env.SMTP_CA || undefined,
  });
  return { via: 'smtp' };
}

// ---- mensagem MIME (texto + HTML, UTF-8) ----
const encWord = s => '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?=';
const b64lines = s => Buffer.from(String(s), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
export function mime({ fromName, from, to, subject, text, html, unsubscribe, replyTo }) {
  const bnd = 'ag' + crypto.randomBytes(12).toString('hex');
  const dom = String(from).split('@')[1] || 'autograna';
  const head = [
    'From: ' + encWord(fromName) + ' <' + from + '>',
    'To: <' + to + '>',
    'Subject: ' + encWord(subject),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomUUID() + '@' + dom + '>',
    'MIME-Version: 1.0',
  ];
  if (replyTo) head.push('Reply-To: <' + replyTo + '>');
  if (unsubscribe) head.push('List-Unsubscribe: <' + unsubscribe + '>', 'List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  head.push('Content-Type: multipart/alternative; boundary="' + bnd + '"');
  return head.join('\r\n') + '\r\n\r\n' +
    '--' + bnd + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64lines(text) + '\r\n' +
    '--' + bnd + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64lines(html) + '\r\n' +
    '--' + bnd + '--';
}

// ---- cliente SMTP mínimo (TLS direto, porta 465) ----
export function smtp({ host, port, user, pass, from, to, message, ca, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const steps = [
      [null, [220]],
      ['EHLO autograna', [250]],
      ['AUTH PLAIN ' + Buffer.from('\u0000' + user + '\u0000' + pass, 'utf8').toString('base64'), [235]],
      ['MAIL FROM:<' + from + '>', [250]],
      ['RCPT TO:<' + to + '>', [250, 251]],
      ['DATA', [354]],
      [String(message).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.', [250]],
      ['QUIT', [221]],
    ];
    let i = 0, buf = '', done = false;
    const sock = tls.connect({ host, port, servername: host, ca });
    const finish = (err) => { if (done) return; done = true; try { sock.end(); } catch (e) { /* */ } err ? reject(err) : resolve(); };
    sock.setEncoding('utf8');
    sock.setTimeout(timeoutMs, () => { finish(new Error('SMTP: sem resposta do servidor')); sock.destroy(); });
    sock.on('error', e => finish(new Error('SMTP: ' + e.message)));
    sock.on('close', () => { if (!done) finish(i >= steps.length - 1 ? null : new Error('SMTP: conexão fechada no passo ' + i)); });
    sock.on('data', chunk => {
      buf += chunk;
      const m = buf.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
      if (!m) return;                                  // resposta ainda incompleta (ou várias linhas "250-")
      const code = parseInt(m[1], 10), line = buf.trim().split('\r\n').pop();
      buf = '';
      if (!steps[i][1].includes(code)) {
        const hint = code === 535 ? ' (usuário ou senha de app recusados)' : '';
        finish(new Error('SMTP ' + line + hint)); return;
      }
      i++;
      if (i >= steps.length) { finish(null); return; }
      sock.write(steps[i][0] + '\r\n');
    });
  });
}

// ---- textos ----
export const REASONS = {
  caro: 'Achei caro',
  dificil: 'Não entendi como usar',
  poucouso: 'Não usei o suficiente',
  faltou: 'Faltou alguma coisa que eu precisava',
  outroapp: 'Prefiro outro app ou planilha',
  outro: 'Outro motivo',
};

const TZ = 'America/Sao_Paulo';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
const ymdSP = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
export const spHour = d => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(d))) % 24;
const ddmm = d => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(new Date(d));
const hhmm = d => { const t = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d)); return t.endsWith(':00') ? t.slice(0, 2) + 'h' : t.replace(':', 'h'); };
// "amanhã (26/10), às 16h" / "hoje, às 16h" / "em 27/10, às 9h30"
export function quando(d, now = new Date()) {
  const a = ymdSP(d), hoje = ymdSP(now), amanha = ymdSP(+new Date(now) + 86400000);
  const dia = a === hoje ? 'hoje' : a === amanha ? 'amanhã (' + ddmm(d) + ')' : 'em ' + ddmm(d);
  return dia + ', às ' + hhmm(d);
}
const relDay = (d, now) => { const a = ymdSP(d); return a === ymdSP(now) ? 'hoje' : a === ymdSP(+new Date(now) + 86400000) ? 'amanhã' : 'em ' + ddmm(d); };
export const firstName = b => {
  const n = String((b && b.name) || '').trim().split(/\s+/)[0];
  if (n) return n.charAt(0).toUpperCase() + n.slice(1);
  return '';
};
const brandName = id => ({ visa: 'Visa', master: 'Mastercard', amex: 'Amex', elo: 'Elo', hipercard: 'Hipercard', diners: 'Diners', debvisa: 'Visa', debmaster: 'Mastercard', debelo: 'Elo' }[String(id || '').toLowerCase()] || '');

function layout({ site, preheader, body, footer }) {
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Autograna</title></head>' +
    '<body style="margin:0;padding:0;background:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#0E1726">' +
    '<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;max-height:0;overflow:hidden">' + esc(preheader) + '</span>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px"><tr><td style="padding:28px 26px 26px">' +
    '<div style="margin:0 0 22px"><img src="' + esc(site) + '/icon-192.png" width="34" height="34" alt="" style="vertical-align:middle;border-radius:9px;border:0"> ' +
    '<span style="font-weight:700;font-size:19px;vertical-align:middle;letter-spacing:-.2px">Auto<span style="color:#0E9F6E">grana</span></span></div>' +
    '<div style="font-size:16px;line-height:1.55">' + body + '</div>' +
    '</td></tr></table>' +
    '<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#748093">' + footer + '</p>' +
    '</td></tr></table></body></html>';
}
const p = h => '<p style="margin:0 0 14px">' + h + '</p>';
const btn = (href, label) => '<p style="margin:22px 0 22px"><a href="' + esc(href) + '" style="display:inline-block;background:#2F6BFF;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:16px;padding:13px 22px;border-radius:12px">' + esc(label) + '</a></p>';
const foot = (unsub) => 'Você recebe este e-mail porque criou uma conta no Autograna. <a href="' + esc(unsub) + '" style="color:#748093">Não quero mais receber e-mails</a>.';

// Teste acabando e a pessoa ainda não escolheu como pagar.
export function tplTrialEnding({ b, site, links, price, now = new Date() }) {
  const nome = firstName(b), q = quando(b.trialEnd, now);
  const subject = 'Seu teste do Autograna acaba ' + relDay(b.trialEnd, now);
  const pre = 'Cadastre o cartão ou pague no Pix pra continuar sem perder nada.';
  const body = p('Oi' + (nome ? ', ' + esc(nome) : '') + '!') +
    p('Seu teste grátis do Autograna acaba <b>' + esc(q) + '</b>.') +
    p('Pra continuar usando sem interrupção (e sem perder nada do que você já lançou), é só assinar: <b>' + brl(price) + ' por mês</b>, no Pix ou no cartão.') +
    p('Se cadastrar o cartão agora, a 1ª cobrança só acontece quando o teste acabar. E dá pra cancelar quando quiser, direto no app.') +
    btn(links.subscribe, 'Continuar usando o Autograna') +
    p('<span style="color:#465263">Ficou alguma dúvida? É só responder este e-mail.</span>');
  const text = 'Oi' + (nome ? ', ' + nome : '') + '!\n\nSeu teste grátis do Autograna acaba ' + q + '.\n\nPra continuar usando sem perder nada, é só assinar: ' + brl(price) + ' por mês, no Pix ou no cartão. Se cadastrar o cartão agora, a 1ª cobrança só acontece quando o teste acabar, e dá pra cancelar quando quiser.\n\nContinuar usando: ' + links.subscribe + '\n\nNão quer mais receber e-mails? ' + links.unsubscribe + '\n';
  return { subject, html: layout({ site, preheader: pre, body, footer: foot(links.unsubscribe) }), text };
}

// Cartão cadastrado no teste: lembra da 1ª cobrança (transparência evita susto e contestação).
export function tplFirstCharge({ b, site, links, price, now = new Date() }) {
  const nome = firstName(b), q = quando(b.trialEnd, now), rd = relDay(b.trialEnd, now);
  const marca = brandName(b.cardBrand), fim = b.cardLast4 ? ' final ' + b.cardLast4 : '';
  const cartao = (marca ? 'cartão ' + marca : 'seu cartão') + fim;
  const subject = (rd === 'hoje' ? 'Hoje' : rd === 'amanhã' ? 'Amanhã' : 'Em breve') + ' começa sua assinatura do Autograna';
  const body = p('Oi' + (nome ? ', ' + esc(nome) : '') + '!') +
    p('Seu teste grátis termina <b>' + esc(q) + '</b>. Nessa hora, a 1ª cobrança de <b>' + brl(price) + '</b> vai para o ' + esc(cartao) + '. Você não precisa fazer nada.') +
    p('A assinatura renova todo mês e você cancela quando quiser em <b>Ajustes › Assinatura</b>. Se não quiser continuar, cancele antes dessa data e nada será cobrado.') +
    btn(links.app, 'Abrir o Autograna');
  const text = 'Oi' + (nome ? ', ' + nome : '') + '!\n\nSeu teste grátis termina ' + q + '. Nessa hora, a 1ª cobrança de ' + brl(price) + ' vai para o ' + cartao + '. Você não precisa fazer nada.\n\nA assinatura renova todo mês e você cancela quando quiser em Ajustes > Assinatura. Se não quiser continuar, cancele antes dessa data e nada será cobrado.\n\nAbrir o Autograna: ' + links.app + '\n';
  return { subject, html: layout({ site, preheader: 'A 1ª cobrança é ' + q + '. Cancele antes se não quiser continuar.', body, footer: foot(links.unsubscribe) }), text };
}

// Teste acabou sem pagar: pergunta se não quer assinar e por quê (um clique).
export function tplTrialEnded({ b, site, links, price }) {
  const nome = firstName(b);
  const subject = 'Não quer continuar com o Autograna? Conta pra gente por quê';
  const reasons = Object.entries(REASONS).map(([k, label]) =>
    '<a href="' + esc(links.reason(k)) + '" style="display:block;border:1px solid #D9DEE5;border-radius:12px;padding:12px 14px;margin:0 0 8px;color:#0E1726;text-decoration:none;font-size:15px">' + esc(label) + '</a>').join('');
  const body = p('Oi' + (nome ? ', ' + esc(nome) : '') + '!') +
    p('Seu teste grátis do Autograna terminou. Seus lançamentos, contas e metas continuam guardados: se quiser continuar, é só assinar e tudo volta de onde parou.') +
    btn(links.subscribe, 'Quero continuar · ' + brl(price) + '/mês') +
    p('<b>Se decidiu não assinar, pode contar o porquê?</b> É um clique e ajuda muito a melhorar o app:') +
    '<div style="margin:0 0 18px">' + reasons + '</div>' +
    p('<span style="color:#465263">Obrigado por ter testado!</span>');
  const text = 'Oi' + (nome ? ', ' + nome : '') + '!\n\nSeu teste grátis do Autograna terminou. Seus dados continuam guardados: se quiser continuar, é só assinar (' + brl(price) + '/mês): ' + links.subscribe +
    '\n\nSe decidiu não assinar, pode contar o porquê? É um clique:\n' + Object.entries(REASONS).map(([k, l]) => '- ' + l + ': ' + links.reason(k)).join('\n') +
    '\n\nObrigado por ter testado!\n\nNão quer mais receber e-mails? ' + links.unsubscribe + '\n';
  return { subject, html: layout({ site, preheader: 'Seus dados continuam guardados. E se puder, conta o que faltou.', body, footer: foot(links.unsubscribe) }), text };
}
