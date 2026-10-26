import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CommentsSheet from '../components/CommentsSheet';
import PostCard from '../components/PostCard';
import StackPage from '../components/StackPage';
import { api } from '../lib/api';

/** Uma publicação aberta a partir de uma notificação ou ligação. `?comments=1` abre logo os comentários. */
export default function PostPage() {
  const { postId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['post', postId], queryFn: () => api.getPost(postId), retry: false });
  return (
    <StackPage title="Publicação">
      <div className="pt-4">
        {q.isLoading && <p className="py-16 text-center text-zinc-500">A carregar…</p>}
        {q.isError && (
          <div className="mx-6 mt-12 text-center">
            <p className="text-5xl">🕵️</p>
            <p className="mt-3 text-xl font-bold">Esta publicação já não está disponível</p>
            <p className="mt-1 text-zinc-600">Pode ter sido apagada, ou a conta passou a privada.</p>
          </div>
        )}
        {q.data && <PostCard post={q.data} />}
      </div>
      {q.data && params.get('comments') && (
        <CommentsSheet post={q.data} onClose={() => navigate(`/p/${postId}`, { replace: true })} onDelta={() => void q.refetch()} />
      )}
    </StackPage>
  );
}
