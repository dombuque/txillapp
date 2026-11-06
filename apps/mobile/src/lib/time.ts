/** "Agora", "Há 5min", "Há 3h", "Há 2d": o mesmo texto do site. */
export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'Agora';
  if (s < 3600) return `Há ${Math.floor(s / 60)}min`;
  if (s < 86400) return `Há ${Math.floor(s / 3600)}h`;
  return `Há ${Math.floor(s / 86400)}d`;
}
