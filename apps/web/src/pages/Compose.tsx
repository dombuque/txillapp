import { useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, btnPrimary, lineInput } from '../components/ui';
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
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return setErr('Essa foto não serve. Usa JPEG, PNG ou WebP 🙃');
    if (f.size > MAX) return setErr('Foto pesada demais! Máximo 8 MB 🏋️');
    setErr('');
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setErr('Escreve alguma coisa, não fiques calado 🙃');
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
    <Page title="O que se passa? 😎" sub="Conta à malta o que estás a viver">
      <form onSubmit={submit} className="space-y-6" noValidate>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Escreve aqui…"
          aria-label="Texto da publicação"
          className={`${lineInput} resize-none text-xl`}
        />
        <input
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          maxLength={80}
          placeholder="Onde estás? Bairro, praia, esquina… 📍"
          aria-label="Local"
          className={lineInput}
        />
        {preview && <img src={preview} alt="Pré-visualização" className="max-h-80 w-full rounded-2xl object-cover" />}
        <label className="block cursor-pointer rounded-full border border-dashed border-zinc-400 py-3.5 text-center text-zinc-600 active:scale-[0.98]">
          {file ? 'Trocar a foto 🔄' : '📷 Mete uma foto'}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="sr-only" />
        </label>
        <p role="alert" className="min-h-6 text-center text-red-600">{err}</p>
        <button disabled={busy} className={`${btnPrimary} w-full py-5 text-lg`}>
          {busy ? 'A publicar… 🚀' : 'Publicar'}
        </button>
      </form>
    </Page>
  );
}
