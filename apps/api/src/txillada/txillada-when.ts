/** O fuso de Moçambique (os textos do servidor, como os do telemóvel, dizem a hora de cá). */
export const TX_TZ = 'Africa/Maputo';

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-PT', { timeZone: TX_TZ, ...o });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TX_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const time = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const weekday = fmt({ weekday: 'long' });
const dayMonth = fmt({ day: 'numeric', month: 'long' });

/**
 * A hora de uma Txillada agendada em palavras, para os avisos: «hoje, 20:00», «amanhã, 20:00», «sábado, 20:00» (nos próximos
 * 7 dias) ou «21 de novembro, 20:00».
 */
export function whenLabel(at: Date | string, now = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((Date.parse(dayKey.format(d)) - Date.parse(dayKey.format(now))) / 86_400_000);
  const t = time.format(d);
  if (days === 0) return `hoje, ${t}`;
  if (days === 1) return `amanhã, ${t}`;
  if (days > 1 && days < 7) return `${weekday.format(d)}, ${t}`;
  return `${dayMonth.format(d)}, ${t}`;
}
