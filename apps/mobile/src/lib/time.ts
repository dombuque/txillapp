/** "agora", "há 5 min", "há 3 h", "há 2 d" e depois a data. */
export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'agora';
  if (s < 3600) return `há ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  if (s < 86400 * 7) return `há ${Math.round(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
}
