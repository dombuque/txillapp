import Icon from '../components/Icon';
import { track } from '../lib/analytics';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Camera from '../components/Camera';
import MentionTextarea from '../components/MentionTextarea';
import PhotoTagger from '../components/PhotoTagger';
import PlaceSheet from '../components/PlacePicker';
import { Avatar, Sheet } from '../components/ui';
import { api, type PhotoTag } from '../lib/api';
import { useAuth } from '../lib/auth';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 10;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface Photo {
  file: File;
  preview: string;
  tags: PhotoTag[];
}

export default function Compose() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [place, setPlace] = useState('');
  const [placeOpen, setPlaceOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  // Um vídeo curto (até 60 s) em vez de fotos.
  const [video, setVideo] = useState<{ file: File; preview: string; durationMs: number } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const canPost = (body.trim().length > 0 || photos.length > 0 || !!video) && !busy;

  function pickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('video/')) return setErr('Isso não é um vídeo');
    if (f.size > 100 * 1024 * 1024) return setErr('Vídeo pesado demais! Máximo 100 MB');
    const url = URL.createObjectURL(f);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const ms = Math.round(probe.duration * 1000);
      if (!Number.isFinite(ms) || ms <= 0) {
        // O browser não consegue ler a duração (formato raro): deixa o servidor decidir.
        setVideo({ file: f, preview: url, durationMs: 0 });
        setErr('');
      } else if (ms > 60_500) {
        URL.revokeObjectURL(url);
        setErr('O vídeo tem de ter até 60 segundos ⏱️');
      } else {
        setVideo({ file: f, preview: url, durationMs: ms });
        setErr('');
      }
    };
    probe.onerror = () => {
      setVideo({ file: f, preview: url, durationMs: 0 });
      setErr('');
    };
    probe.src = url;
  }


  const [cameraOpen, setCameraOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [tagging, setTagging] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const settled = useRef(false); // publicado ou descartado: não voltar a guardar rascunho
  const hasContent = body.trim().length > 0 || photos.length > 0;
  const draftKey = user!.username;

  // Recupera o rascunho guardado (texto, local e fotos).
  useEffect(() => {
    let alive = true;
    void loadDraft(draftKey).then((d) => {
      if (!alive || !d) return;
      setBody(d.body);
      setPlace(d.place);
      setPhotos(d.photos.map((file, i) => ({ file, preview: URL.createObjectURL(file), tags: d.tags?.[i] ?? [] })));
      setRestored(true);
    });
    return () => { alive = false; };
  }, [draftKey]);

  // Se saíres por outro caminho (menu, voltar), o que escreveste fica guardado em vez de se perder.
  const latest = useRef({ body, place, photos, hasContent });
  latest.current = { body, place, photos, hasContent };
  useEffect(() => () => {
    const l = latest.current;
    if (!settled.current && l.hasContent) void saveDraft(draftKey, { body: l.body, place: l.place, photos: l.photos.map((p) => p.file), tags: l.photos.map((p) => p.tags) });
  }, [draftKey]);

  function leave() {
    if (hasContent) setLeaveOpen(true);
    else navigate(-1);
  }
  async function keepDraft() {
    await saveDraft(draftKey, { body, place, photos: photos.map((p) => p.file), tags: photos.map((p) => p.tags) });
    settled.current = true;
    navigate(-1);
  }
  async function discard() {
    settled.current = true;
    await clearDraft(draftKey);
    navigate(-1);
  }

  // Fotos tiradas na câmara do Txillapp ou escolhidas da galeria entram pelo mesmo caminho.
  function addFiles(files: File[]) {
    const next = [...photos];
    let problem = '';
    for (const f of files) {
      if (next.length >= MAX_PHOTOS) {
        problem = `Máximo de ${MAX_PHOTOS} fotos por publicação`;
        break;
      }
      if (!TYPES.includes(f.type)) problem = 'Uma das fotos não serve. Usa JPEG, PNG ou WebP';
      else if (f.size > MAX_BYTES) problem = 'Uma das fotos é pesada demais! Máximo 8 MB';
      else next.push({ file: f, preview: URL.createObjectURL(f), tags: [] });
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
      if (video) {
        mediaIds.push(
          await api.uploadVideo(video.file, {
            progress: (f) => setProgress(`A enviar o vídeo… ${Math.round(f * 100)}%`),
            stage: (s) => setProgress(s === 'processing' ? 'A preparar o vídeo… (pode demorar um pouco)' : 'A enviar o vídeo…'),
          }),
        );
      }
      for (const [i, p] of photos.entries()) {
        setProgress(`A enviar foto ${i + 1} de ${photos.length}…`);
        mediaIds.push(await api.uploadImage(p.file));
      }
      setProgress(null);
      await api.createPost({
        body,
        locationLabel: place || undefined,
        mediaIds,
        tags: photos.flatMap((p, index) => p.tags.map((t) => ({ index, username: t.username, x: t.x, y: t.y }))),
      });
      settled.current = true;
      await clearDraft(draftKey);
      track('post_create', { video: !!video, photos: photos.length, tags: photos.reduce((n, p) => n + p.tags.length, 0), place: !!place });
      await qc.invalidateQueries({ queryKey: ['feed'] });
      navigate('/');
    } catch (x) {
      setErr((x as Error).message);
      setProgress(null);
      setBusy(false);
    }
  }

  const first = user?.displayName.split(' ')[0] ?? '';
  const left = 2000 - body.length;
  const chip = 'flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-100 text-sm font-semibold text-zinc-800 transition active:scale-95 active:bg-zinc-200';
  const icon = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
  return (
    <form onSubmit={submit} noValidate>
      <div className="flex items-center justify-between px-3 pb-3">
        <button type="button" onClick={leave} aria-label="Cancelar" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-600 active:bg-zinc-100">
          <Icon name="x" size={24} />
        </button>
        <h1 className="text-lg font-bold">Nova publicação</h1>
        <button disabled={!canPost} className="h-10 rounded-full bg-brand px-5 font-bold text-white shadow-sm transition active:scale-95 disabled:bg-brand/40 disabled:shadow-none">
          {busy ? 'A enviar…' : 'Publicar'}
        </button>
      </div>

      {restored && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-2 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm">
          <span className="font-semibold text-zinc-800">Rascunho recuperado</span>
          <button
            type="button"
            onClick={() => { photos.forEach((p) => URL.revokeObjectURL(p.preview)); setBody(''); setPlace(''); setPhotos([]); setRestored(false); void clearDraft(draftKey); }}
            className="font-bold text-brand"
          >
            Descartar
          </button>
        </div>
      )}

      <div className="mx-4 rounded-[28px] bg-white shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
        <div className="flex items-center gap-3 px-5 pt-5">
          <Avatar name={user?.displayName ?? '?'} username={user?.username} size={48} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold leading-tight">{user?.displayName}</p>
            {place ? (
              <span className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-full bg-rose-50 py-0.5 pl-2.5 pr-1 text-sm font-semibold text-brand">
                <button type="button" onClick={() => setPlaceOpen(true)} className="truncate"><Icon name="map-pin" size={16} className="mr-1 inline align-[-3px]" />{place}</button>
                <button type="button" onClick={() => setPlace('')} aria-label="Tirar o local" className="px-1.5 text-base">×</button>
              </span>
            ) : (
              <p className="text-sm text-zinc-500">@{user?.username}</p>
            )}
          </div>
        </div>

        <div className="px-5 pt-3">
          <MentionTextarea
            inline
            value={body}
            onChange={setBody}
            maxLength={2000}
            placeholder={`O que se passa, ${first}?`}
            aria-label="Texto da publicação"
            className="min-h-[110px] w-full resize-none bg-transparent text-xl leading-snug outline-none placeholder:text-zinc-500"
          />
          {left < 200 && <p className={`text-right text-xs ${left < 50 ? 'font-semibold text-brand' : 'text-zinc-500'}`} aria-live="polite">{left}</p>}
        </div>

        {video && (
          <div className="relative mx-5 mb-2 mt-1 overflow-hidden rounded-2xl bg-black">
            <video src={video.preview} controls playsInline muted preload="metadata" className="max-h-80 w-full object-contain" />
            <button type="button" onClick={() => { URL.revokeObjectURL(video.preview); setVideo(null); }} aria-label="Tirar o vídeo" className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm active:scale-90">
              <Icon name="x" size={16} />
            </button>
          </div>
        )}

        {photos.length > 0 && (
          <ul className={`grid gap-2 px-5 pb-2 pt-1 ${photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {photos.map((p, i) => (
              <li key={p.preview} className={`relative overflow-hidden rounded-2xl bg-zinc-200 ${photos.length === 1 ? 'aspect-[4/3]' : i === 0 && photos.length % 2 === 1 ? 'col-span-2 aspect-[16/10]' : 'aspect-square'}`}>
                <img src={p.preview} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                {i === 0 && photos.length > 1 && (
                  <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-semibold text-white">Capa</span>
                )}
                <button
                  type="button"
                  onClick={() => setTagging(i)}
                  aria-label={`Identificar pessoas na foto ${i + 1}`}
                  className="absolute bottom-2 right-2 flex h-8 items-center gap-1 rounded-full bg-black/60 px-2.5 text-xs font-semibold text-white backdrop-blur-sm active:scale-95"
                >
                  <Icon name="users" size={16} className="mr-1 inline align-[-3px]" />{p.tags.length ? p.tags.length : 'Identificar'}
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Tirar a foto ${i + 1}`}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm active:scale-90"
                >
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 border-t border-zinc-100 px-4 py-3">
          <div className="flex gap-2">
            {/* Uma só entrada: abre a câmara do Txillapp, com a galeria lá dentro. */}
            <button type="button" onClick={() => setCameraOpen(true)} disabled={photos.length >= MAX_PHOTOS || !!video} title="Foto" className={`${chip} disabled:opacity-40`}>
              <Icon name="camera" size={20} />
              Foto
            </button>
            <label className={`${chip} cursor-pointer ${photos.length > 0 || video ? 'pointer-events-none opacity-40' : ''}`} title="Vídeo">
              <Icon name="video" size={20} />
              Vídeo
              <input type="file" accept="video/*" onChange={pickVideo} className="sr-only" aria-label="Escolher ou gravar um vídeo" />
            </label>
            <button type="button" onClick={() => setPlaceOpen(true)} title="Local" className={chip}>
              <Icon name="map-pin" size={20} />
              Local
            </button>
          </div>
          {photos.length > 0 && <p className="mt-2 text-center text-xs text-zinc-500">{photos.length}/{MAX_PHOTOS} fotos</p>}
        </div>
      </div>

      <p role="alert" className="mt-4 min-h-6 px-6 text-center text-red-600">{err}</p>
      {progress && <p role="status" className="px-6 text-center text-zinc-600">{progress}</p>}
      {leaveOpen && (
        <Sheet title="Sair sem publicar?" onClose={() => setLeaveOpen(false)}>
          <p className="mb-4 text-zinc-600">Podes guardar isto como rascunho e continuar mais tarde</p>
          <button type="button" onClick={keepDraft} className="h-12 w-full rounded-full bg-brand font-bold text-white active:scale-[0.98]">Guardar rascunho</button>
          <button type="button" onClick={discard} className="mt-2 h-12 w-full rounded-full font-bold text-red-600 active:bg-red-50">Descartar</button>
          <button type="button" onClick={() => setLeaveOpen(false)} className="mt-1 h-12 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">Continuar a editar</button>
        </Sheet>
      )}
      {tagging !== null && photos[tagging] && (
        <PhotoTagger
          src={photos[tagging].preview}
          tags={photos[tagging].tags}
          onDone={(tags) => { setPhotos(photos.map((p, n) => (n === tagging ? { ...p, tags } : p))); setTagging(null); }}
        />
      )}
      {cameraOpen && (
        <Camera
          count={photos.length}
          max={MAX_PHOTOS}
          onShot={(f) => addFiles([f])}
          onGallery={(files) => { addFiles(files); setCameraOpen(false); }}
          onClose={() => setCameraOpen(false)}
        />
      )}
      {placeOpen && <PlaceSheet value={place} onChange={setPlace} onClose={() => setPlaceOpen(false)} />}
    </form>
  );
}
