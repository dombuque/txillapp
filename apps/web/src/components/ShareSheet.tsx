import { useState } from 'react';
import { api, type Post } from '../lib/api';
import { track } from '../lib/analytics';
import Icon from './Icon';
import { Sheet } from './ui';

const row = 'flex w-full items-center gap-4 rounded-2xl px-1 py-3 text-left transition active:bg-zinc-100 disabled:opacity-60';
const dot = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800';

/**
 * Partilhar uma publicação ou reel: no meu status (story), por ligação, ou pelo sistema (WhatsApp, etc.).
 * Só publicações públicas com foto ou vídeo vão para o status.
 */
export default function ShareSheet({ post, onClose, layer }: { post: Post; onClose: () => void; layer?: string }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const url = `${location.origin}/p/${post.id}`;
  const canStory = post.kind === 'post' && post.media.length > 0;

  async function toStory(audience: 'all' | 'close_friends') {
    setBusy(true);
    try {
      await api.shareToStory(post.id, audience);
      track('share', { where: 'story', video: post.media[0]?.kind === 'video' });
      setNote(audience === 'all' ? 'Partilhado no teu status' : 'Partilhado com amigos próximos');
      setTimeout(onClose, 1100);
    } catch (e) {
      setNote((e as Error).message);
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNote('Ligação copiada');
    } catch {
      setNote('Não consegui copiar');
    }
  }
  async function system() {
    track('share', { where: 'system' });
    try {
      await navigator.share({ title: 'Txillapp', text: post.body.slice(0, 80), url });
      onClose();
    } catch {
      /* cancelou */
    }
  }

  return (
    <Sheet title="Partilhar" onClose={onClose} layer={layer}>
      {note && <p role="status" className="mb-2 rounded-xl bg-zinc-50 px-3 py-2 text-center text-sm font-semibold">{note}</p>}
      {canStory && (
        <>
          <button disabled={busy} onClick={() => toStory('all')} className={row}>
            <span className={dot}><Icon name="camera" /></span>
            <span>
              <span className="block text-[17px] font-semibold">Adicionar ao meu status</span>
              <span className="block text-sm text-zinc-600">Fica 24 horas, com a origem e ligação.</span>
            </span>
          </button>
          <button disabled={busy} onClick={() => toStory('close_friends')} className={row}>
            <span className={dot}><Icon name="heart" /></span>
            <span>
              <span className="block text-[17px] font-semibold">Só para amigos próximos</span>
              <span className="block text-sm text-zinc-600">Só quem está na tua lista vê.</span>
            </span>
          </button>
        </>
      )}
      <button onClick={copy} className={row}>
        <span className={dot}><Icon name="link" /></span>
        <span className="text-[17px] font-semibold">Copiar ligação</span>
      </button>
      {typeof navigator.share === 'function' && (
        <button onClick={system} className={row}>
          <span className={dot}><Icon name="share" /></span>
          <span className="text-[17px] font-semibold">Enviar por…</span>
        </button>
      )}
    </Sheet>
  );
}
