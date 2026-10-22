import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type FollowState } from '../lib/api';

/** Seguir / A seguir / Pedido enviado (perfis privados). Optimista, com reversão em caso de erro. */
export default function FollowButton({
  username, following, requested, isPrivate = false, large = false, onChange,
}: {
  username: string; following: boolean; requested: boolean; isPrivate?: boolean; large?: boolean;
  onChange?: (s: FollowState) => void;
}) {
  const qc = useQueryClient();
  const [s, setS] = useState({ following, requested });
  const [busy, setBusy] = useState(false);
  useEffect(() => setS({ following, requested }), [following, requested]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const prev = s;
    try {
      if (s.following || s.requested) {
        setS({ following: false, requested: false });
        onChange?.(await api.unfollow(username));
      } else {
        setS(isPrivate ? { following: false, requested: true } : { following: true, requested: false });
        const r = await api.follow(username);
        setS({ following: r.following, requested: r.requested });
        onChange?.(r);
      }
      // O que se vê muda: stories, sugestões, feed e o próprio perfil.
      for (const key of ['stories', 'suggestions', 'feed']) qc.invalidateQueries({ queryKey: [key] });
      qc.invalidateQueries({ queryKey: ['profile', username] });
      qc.invalidateQueries({ queryKey: ['profile-posts', username] });
    } catch {
      setS(prev);
    } finally {
      setBusy(false);
    }
  }

  const on = s.following || s.requested;
  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={s.following}
      className={`rounded-full font-semibold transition active:scale-95 disabled:opacity-70 ${large ? 'w-full whitespace-nowrap px-4 py-3 text-base' : 'w-full whitespace-nowrap px-3 py-2 text-sm'} ${
        on ? 'border border-zinc-300 bg-white text-zinc-800' : 'bg-brand text-white shadow-[0_6px_16px_rgba(214,51,79,0.3)]'
      }`}
    >
      {s.following ? 'A seguir' : s.requested ? 'Pedido enviado' : 'Seguir'}
    </button>
  );
}
