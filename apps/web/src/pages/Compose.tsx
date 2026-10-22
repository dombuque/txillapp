import { useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { btnPrimary, inputCls } from '../components/ui';
import { api } from '../lib/api';

const MAX = 8 * 1024 * 1024;

export default function Compose() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [place, setPlace] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return setErr('Use uma imagem JPEG, PNG ou WebP.');
    if (f.size > MAX) return setErr('A imagem deve ter no máximo 8 MB.');
    setErr('');
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setErr('Escreva algo para publicar.');
    setBusy(true);
    setErr('');
    try {
      const mediaId = file ? await api.uploadImage(file) : undefined;
      await api.createPost({ body, locationLabel: place || undefined, mediaId });
      await qc.invalidateQueries({ queryKey: ['feed'] });
      navigate('/');
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Nova publicação</h1>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={4} placeholder="O que está a acontecer?" className={inputCls} />
      <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={80} placeholder="Local ou bairro (opcional)" className={inputCls} />
      {preview && <img src={preview} alt="Pré-visualização" className="max-h-80 w-full rounded-2xl object-cover" />}
      <label className="block cursor-pointer rounded-xl border border-dashed border-zinc-300 p-4 text-center text-zinc-500">
        {file ? 'Trocar fotografia' : '📷 Adicionar fotografia'}
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="sr-only" />
      </label>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      <button disabled={busy} className={`${btnPrimary} w-full`}>
        {busy ? 'A publicar…' : 'Publicar'}
      </button>
    </form>
  );
}
