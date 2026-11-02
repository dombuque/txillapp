import { Link } from 'react-router-dom';
import { sized } from '../lib/media';
import type { Post } from '../lib/api';
import Icon from './Icon';

/** Publicação ou reel partilhado numa conversa: miniatura, autor e texto. Tocar abre o post (ou o reel, em ecrã inteiro). */
export default function SharedPost({ post, shape, tone }: { post: Post | null; shape: string; tone: string }) {
  if (!post) {
    return (
      <div className={`flex w-[240px] items-center gap-2 px-4 py-3 text-sm ${shape} ${tone} opacity-80`}>
        <Icon name="lock" size={16} className="shrink-0" /> Publicação indisponível
      </div>
    );
  }
  const shown = post.kind === 'repost' && post.repostOf ? post.repostOf : post;
  const m = shown.media[0];
  const video = m?.kind === 'video';
  const thumb = m ? (video ? m.posterUrl : sized(m.url, 480)) : null;
  return (
    <Link to={video ? `/r/${shown.id}` : `/p/${shown.id}`} className={`block w-[240px] overflow-hidden ${shape} ${tone}`}>
      <span className="flex items-center gap-2 px-3 pt-2.5 text-[13px] font-semibold opacity-90">
        <Icon name={video ? 'film' : 'image'} size={14} /> {video ? 'Reel' : 'Publicação'} de {shown.author.displayName}
      </span>
      {thumb ? (
        <span className="relative mt-2 block h-[170px] w-full bg-zinc-200">
          <img src={thumb} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
          {video && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white"><Icon name="play" size={24} fill="currentColor" /></span>
            </span>
          )}
        </span>
      ) : (
        <span className="mt-1 block px-3 pb-1" />
      )}
      {shown.body && <span className="line-clamp-3 block px-3 py-2.5 text-[15px] leading-snug">{shown.body}</span>}
    </Link>
  );
}
