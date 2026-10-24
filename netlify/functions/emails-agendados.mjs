// Função agendada: o Netlify roda sozinha de hora em hora e manda os e-mails do teste grátis.
// Veja o que ela faz em netlify/lib/emails-job.mjs. Os resultados aparecem em Logs › Functions › emails-agendados.
import { runEmails } from '../lib/emails-job.mjs';

export default async () => {
  try {
    const r = await runEmails();
    console.log('[emails-agendados]', JSON.stringify(r));
  } catch (e) {
    console.error('[emails-agendados]', e);
  }
  return new Response('ok');
};

export const config = { schedule: '@hourly' };
