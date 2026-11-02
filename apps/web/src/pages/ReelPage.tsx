import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
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

  return (
    <div className="fixed inset-0 z-40 bg-black" style={visibleStyle(vv)}>
      {q.isLoading && <div className="flex h-full items-center justify-center"><PontoLoader size={26} /></div>}
      {q.isError && (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center text-white">
          <Icon name="film" size={48} className="text-white/70" />
          <p className="mt-4 text-xl font-extrabold">Este reel já não está disponível</p>
          <p className="mt-1 text-white/75">Pode ter sido apagado, ou a conta passou a privada.</p>
          <Link to="/reels" className="mt-6 rounded-full bg-brand px-7 py-3 font-bold active:scale-95">Ver outros reels</Link>
        </div>
      )}
      {post && isVideo && (
        <div className="mx-auto h-full max-w-xl">
          <Reel post={post} active onChange={patch} onMore={() => navigate('/reels')} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto flex max-w-xl items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <button onClick={close} aria-label="Voltar" className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90"><Icon name="back" size={24} /></button>
        <span className="text-lg font-extrabold drop-shadow">Reel</span>
        <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Ligar o som' : 'Desligar o som'} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm active:scale-90">
          <Icon name={muted ? 'volume-off' : 'volume'} size={22} />
        </button>
      </div>
    </div>
  );
}
