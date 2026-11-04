import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tr } from '../lib/i18n';
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { PontoLoader } from '../components/Loading';
import { setMuted, useMuted } from '../components/VideoPlayer';
import { api, type Post } from '../lib/api';
import { useVisualViewport, visibleStyle } from '../lib/useVisualViewport';
import { Reel } from './Reels';

/** Um reel aberto a partir de uma ligação, partilha ou status: ecrã inteiro, a tocar, com a seta de voltar. */
export default function ReelPage() {
  const { postId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const vv = useVisualViewport();
  const muted = useMuted(true);
  const q = useQuery({ queryKey: ['post', postId], queryFn: () => api.getPost(postId), retry: false });
  const post = q.data ? (q.data.kind === 'repost' && q.data.repostOf ? q.data.repostOf : q.data) : null;
  const isVideo = post?.media[0]?.kind === 'video';
  const patch = (c: Partial<Post>) => qc.setQueryData(['post', postId], (d: Post | undefined) => (d ? { ...d, ...c } : d));
  const close = () => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }));

  // Uma publicação que não é vídeo abre como publicação normal.
  useEffect(() => {
    if (post && !isVideo) navigate(`/p/${post.id}`, { replace: true });
  }, [post, isVideo, navigate]);

  // Arrastar para a direita fecha o reel (como voltar no iPhone). Não conta dentro de janelas abertas nem sobre a barra de progresso.
  const t = useRef<{ x: number; y: number; ok: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const start = (e: TouchEvent) => {
    const el = e.target as Element;
    t.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, ok: !el.closest('[aria-modal="true"],input,textarea,select,[role="slider"],[data-swipe]') };
  };
  const move = (e: TouchEvent) => {
    const s = t.current;
    if (!s || !s.ok) return;
    const mx = e.touches[0].clientX - s.x;
    const my = e.touches[0].clientY - s.y;
    if (mx > 12 && mx > Math.abs(my) * 1.8) setDx(Math.min(mx, 160));
    else if (Math.abs(my) > 14) s.ok = false;
  };
  const end = (e: TouchEvent) => {
    const s = t.current;
    t.current = null;
    const moved = s?.ok ? e.changedTouches[0].clientX - s.x : 0;
    setDx(0);
    if (s?.ok && moved > 90) {
      navigator.vibrate?.(8);
      close();
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black" style={{ ...visibleStyle(vv), transform: dx ? `translateX(${dx * 0.5}px)` : undefined, transition: dx ? 'none' : 'transform .2s ease-out' }} onTouchStart={start} onTouchMove={move} onTouchEnd={end}>
      {q.isLoading && <div className="flex h-full items-center justify-center"><PontoLoader size={26} /></div>}
      {q.isError && (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center text-white">
          <Icon name="film" size={48} className="text-white/70" />
          <p className="mt-4 text-xl font-extrabold">{tr('Este reel já não está disponível')}</p>
          <p className="mt-1 text-white/75">{tr('Pode ter sido apagado, ou a conta passou a privada.')}</p>
          <Link to="/reels" className="mt-6 rounded-full bg-brand px-7 py-3 font-bold active:scale-95">{tr('Ver outros reels')}</Link>
        </div>
      )}
      {post && isVideo && (
        <div className="mx-auto h-full max-w-xl">
          <Reel post={post} active onChange={patch} onMore={() => navigate('/reels')} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto flex max-w-xl items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <button onClick={close} aria-label={tr('Voltar')} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90"><Icon name="back" size={24} /></button>
        <span className="text-lg font-extrabold drop-shadow">{tr('Reel')}</span>
        <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Ligar o som' : 'Desligar o som'} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90">
          <Icon name={muted ? 'volume-off' : 'volume'} size={22} />
        </button>
      </div>
    </div>
  );
}
