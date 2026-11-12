/** A largura da foto de perfil em grande (o servidor dá até 1080; sem `w`, a de 256 das bolinhas). */
export const AVATAR_BIG_W = 1080;

/**
 * Caminho da foto de perfil de alguém (junta-se ao SITE_URL). `v`: a versão depois de mudar a foto (components/Avatar),
 * para não vir a antiga da cache. `w`: a largura pedida (só para a foto em grande).
 */
export function avatarPath(username: string, opts: { v?: number; w?: number } = {}): string {
  const q: string[] = [];
  if (opts.v) q.push(`v=${opts.v}`);
  if (opts.w) q.push(`w=${opts.w}`);
  return `/api/v1/avatars/${encodeURIComponent(username)}${q.length ? `?${q.join('&')}` : ''}`;
}
