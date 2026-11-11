import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PrivacySettings } from '@/lib/api';

/**
 * As definições de privacidade (a mesma consulta `['privacy']` que o resto da app usa, ex.: as estatísticas de uso).
 * `save` muda logo no ecrã e volta atrás se o servidor recusar; depois atualiza perfil, feed e sugestões.
 */
export function usePrivacy() {
  const qc = useQueryClient();
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: api.privacy });
  const p = privacy.data;
  async function save(patch: Partial<PrivacySettings>) {
    const prev = qc.getQueryData<PrivacySettings>(['privacy']);
    if (prev) qc.setQueryData(['privacy'], { ...prev, ...patch });
    try {
      qc.setQueryData(['privacy'], await api.setPrivacy(patch));
      for (const key of ['profile', 'feed', 'suggestions']) void qc.invalidateQueries({ queryKey: [key] });
    } catch {
      qc.setQueryData(['privacy'], prev);
    }
  }
  return { p, save };
}
