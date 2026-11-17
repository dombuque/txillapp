import { intlLocale, t, type Lang } from '../i18n/i18n';

/** O fuso de Moçambique (os textos do servidor, como os do telemóvel, dizem a hora de cá). */
export const TX_TZ = 'Africa/Maputo';

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TX_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Os formatos de cada idioma (feitos uma vez). */
const formats = new Map<Lang, { time: Intl.DateTimeFormat; weekday: Intl.DateTimeFormat; dayMonth: Intl.DateTimeFormat }>();
function formatsOf(lang: Lang) {
  let f = formats.get(lang);
  if (!f) {
    const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlLocale(lang), { timeZone: TX_TZ, ...o });
    f = { time: fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), weekday: fmt({ weekday: 'long' }), dayMonth: fmt({ day: 'numeric', month: 'long' }) };
    formats.set(lang, f);
  }
  return f;
}

/**
 * A hora de uma Txillada agendada em palavras, para os avisos: «hoje, 20:00», «amanhã, 20:00», «sábado, 20:00» (nos próximos
 * 7 dias) ou «21 de novembro, 20:00». No idioma de quem recebe o aviso (`lang`), com o Intl.
 */
export function whenLabel(at: Date | string, now = new Date(), lang: Lang = 'pt'): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return '';
  const f = formatsOf(lang);
  const days = Math.round((Date.parse(dayKey.format(d)) - Date.parse(dayKey.format(now))) / 86_400_000);
  const time = f.time.format(d);
  if (days === 0) return t('hoje, {time}', { time }, lang);
  if (days === 1) return t('amanhã, {time}', { time }, lang);
  if (days > 1 && days < 7) return `${f.weekday.format(d)}, ${time}`;
  return `${f.dayMonth.format(d)}, ${time}`;
}
