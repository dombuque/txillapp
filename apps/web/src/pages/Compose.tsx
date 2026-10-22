import { useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import PlaceSheet from '../components/PlacePicker';
import { Avatar } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 10;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface Photo {
  file: File;
  preview: string;
}

export default function Compose() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [place, setPlace] = useState('');
  const [placeOpen, setPlaceOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const canPost = (body.trim().length > 0 || photos.length > 0) && !busy;

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // permite escolher a mesma foto outra vez
    const next = [...photos];
    let problem = '';
    for (const f of files) {
      if (next.length >= MAX_PHOTOS) {
        problem = `Máximo de ${MAX_PHOTOS} fotos por publicação 📸`;
        break;
      }
      if (!TYPES.includes(f.type)) problem = 'Uma das fotos não serve. Usa JPEG, PNG ou WebP 🙃';
      else if (f.size > MAX_BYTES) problem = 'Uma das fotos é pesada demais! Máximo 8 MB 🏋️';
      else next.push({ file: f, preview: URL.createObjectURL(f) });
    }
    setErr(problem);
    setPhotos(next);
  }

  function remove(i: number) {
    URL.revokeObjectURL(photos[i].preview);
    setPhotos(photos.filter((_, n) => n !== i));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    setBusy(true);
    setErr('');
    try {
      const mediaIds: string[] = [];
      for (const [i, p] of photos.entries()) {
        setProgress(`A enviar foto ${i + 1} de ${photos.length}… 📤`);
        mediaIds.push(await api.uploadImage(p.file));
      }
      setProgress(null);
      await api.createPost({ body, locationLabel: place || undefined, mediaIds });
      await qc.invalidateQueries({ queryKey: ['feed'] });
      navigate('/');
    } catch (x) {
      setErr((x as Error).message);
      setProgress(null);
      setBusy(false);
    }
  }

  const first = user?.displayName.split(' ')[0] ?? '';
  const tool = 'flex h-11 w-11 items-center justify-center rounded-full text-2xl transition active:scale-90 hover:bg-zinc-100';
  return (
    <form onSubmit={submit} noValidate>
      <div className="flex items-center justify-between px-4 pb-3">
        <button type="button" onClick={() => navigate(-1)} aria-label="Cancelar" className="px-2 text-3xl leading-none text-zinc-500">
          ×
        </button>
        <h1 className="text-lg font-bold">Nova publicação</h1>
        <button disabled={!canPost} className="rounded-full bg-brand px-5 py-2 font-semibold text-white transition active:scale-95 disabled:opacity-40">
          {busy ? '…' : 'Publicar'}
        </button>
      </div>

      <div className="mx-4 rounded-[28px] bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
        <div className="flex items-center gap-3">
          <Avatar name={user?.displayName ?? '?'} size={48} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold leading-tight">{user?.displayName}</p>
            {place ? (
              <span className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-full bg-rose-50 py-0.5 pl-2.5 pr-1 text-sm font-semibold text-brand">
                <button type="button" onClick={() => setPlaceOpen(true)} className="truncate">📍 {place}</button>
                <button type="button" onClick={() => setPlace('')} aria-label="Tirar o local" className="px-1.5 text-base">×</button>
              </span>
            ) : (
              <p className="text-sm text-zinc-400">@{user?.username}</p>
            )}
          </div>
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          placeholder={`O que se passa, ${first}? 😎`}
          aria-label="Texto da publicação"
          className="mt-4 min-h-[120px] w-full resize-none bg-transparent text-xl outline-none placeholder:text-zinc-400"
        />

        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <li key={p.preview} className="relative aspect-square overflow-hidden rounded-xl bg-zinc-200">
                <img src={p.preview} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                {i === 0 && photos.length > 1 && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">Capa</span>
                )}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Tirar a foto ${i + 1}`}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-sm text-white"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center justify-between rounded-2xl border border-zinc-200 px-4 py-2">
          <span className="font-semibold text-zinc-700">Adicionar à publicação</span>
          <div className="flex">
            {photos.length < MAX_PHOTOS && (
              <label className={`${tool} cursor-pointer`} aria-label="Adicionar fotos" title="Fotos">
                🖼️
                <input type="file" multiple accept={TYPES.join(',')} onChange={pick} className="sr-only" />
              </label>
            )}
            <button type="button" onClick={() => setPlaceOpen(true)} aria-label="Adicionar local" title="Local" className={tool}>
              📍
            </button>
          </div>
        </div>
      </div>

      <p role="alert" className="mt-4 min-h-6 px-6 text-center text-red-600">{err}</p>
      {progress && <p role="status" className="px-6 text-center text-zinc-600">{progress}</p>}
      {placeOpen && <PlaceSheet value={place} onChange={setPlace} onClose={() => setPlaceOpen(false)} />}
    </form>
  );
}
