/** "Agora", "Há 5min", "Há 3h", "Há 2d": o mesmo texto do site. */
import { t } from '@/lib/i18n';
export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'Agora';
  if (s < 3600) return t('Há {n}min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('Há {n}h', { n: Math.floor(s / 3600) });
  return t('Há {n}d', { n: Math.floor(s / 86400) });
}
