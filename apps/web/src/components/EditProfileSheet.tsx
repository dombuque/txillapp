import Icon, { type IconName } from './Icon';
import MentionTextarea from './MentionTextarea';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, type Profile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar, Sheet, bumpAvatars, btnGhost, btnPrimary, fieldInput } from './ui';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 12 * 1024 * 1024; // antes de recortar; a foto final é bem mais pequena

/** Recorta ao centro em quadrado de 512 px e comprime (JPEG): leve para enviar e para mostrar em todo o lado. */
async function cropSquare(file: File, side = 512): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Não consegui abrir essa foto'));
      i.src = url;
    });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(side, s);
    canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Não consegui preparar essa foto');
    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Editar foto, nome, bio e tipo de perfil (público ou privado). */
export default function EditProfileSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const qc = useQueryClient();
  const { patchUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [isPrivate, setIsPrivate] = useState(profile.isPrivate);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(profile.hasAvatar);
  const [err, setErr] = useState('');

  async function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!TYPES.includes(f.type)) return setErr('Essa foto não serve. Usa JPEG, PNG ou WebP');
    if (f.size > MAX_BYTES) return setErr('Foto pesada demais! Máximo 12 MB');
    setPhotoBusy(true);
    setErr('');
    try {
      const mediaId = await api.uploadImage(await cropSquare(f));
      await api.setAvatar(mediaId);
      setHasPhoto(true);
      bumpAvatars(); // a foto nova aparece já em todo o lado
      qc.invalidateQueries({ queryKey: ['profile'] });
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await api.clearAvatar();
      setHasPhoto(false);
      bumpAvatars();
      qc.invalidateQueries({ queryKey: ['profile'] });
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return setErr('Diz-nos o teu nome');
    setBusy(true);
    setErr('');
    try {
      const r = await api.updateMe({ displayName: displayName.trim(), bio: bio.trim(), isPrivate });
      patchUser({ displayName: r.displayName });
      await qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['privacy'] });
      onClose();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  const option = (value: boolean, icon: IconName, title: string, text: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={isPrivate === value}
      onClick={() => setIsPrivate(value)}
      className={`flex flex-1 flex-col items-start rounded-2xl border-2 p-3.5 text-left transition active:scale-[0.98] ${isPrivate === value ? 'border-brand bg-rose-50' : 'border-zinc-200'}`}
    >
      <Icon name={icon} size={26} />
      <span className="mt-1 font-bold">{title}</span>
      <span className="mt-0.5 text-xs leading-4 text-zinc-600">{text}</span>
    </button>
  );

  return (
    <Sheet title="Editar perfil" onClose={onClose}>
      <form onSubmit={save} className="space-y-4" noValidate>
        <div className="flex flex-col items-center gap-3">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} aria-label="Mudar foto de perfil" className="relative rounded-full transition active:scale-95">
            <Avatar name={displayName || profile.displayName} username={hasPhoto ? profile.username : undefined} size={96} />
            <span className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-brand text-white" aria-hidden><Icon name="camera" size={18} /></span>
            {photoBusy && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-white/70 text-sm font-semibold">…</span>}
          </button>
          <input ref={fileRef} type="file" accept={TYPES.join(',')} onChange={pickPhoto} className="sr-only" />
          <div className="flex gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} className={`${btnGhost} !px-4 !py-2 text-sm`}>
              {hasPhoto ? 'Mudar foto' : 'Pôr uma foto'}
            </button>
            {hasPhoto && (
              <button type="button" onClick={removePhoto} disabled={photoBusy} className={`${btnGhost} !px-4 !py-2 text-sm`}>Tirar foto</button>
            )}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-zinc-700">Nome</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} className={fieldInput} autoComplete="name" />
        </label>
        <label className="block">
          <span className="mb-1 flex justify-between text-sm font-semibold text-zinc-700">
            <span>Bio</span>
            <span className={bio.length > 140 ? 'text-brand' : 'text-zinc-500'}>{bio.length}/150</span>
          </span>
          <MentionTextarea value={bio} onChange={setBio} maxLength={150} rows={3} placeholder="Conta à malta quem és…" className={`${fieldInput} resize-none`} />
        </label>
        <div>
          <span className="mb-2 block text-sm font-semibold text-zinc-700">Tipo de perfil</span>
          <div role="radiogroup" aria-label="Tipo de perfil" className="flex gap-3">
            {option(false, 'globe', 'Público', 'Qualquer pessoa vê as tuas publicações e stories e pode seguir-te.')}
            {option(true, 'lock', 'Privado', 'Só vê quem aprovares. Seguir passa a ser um pedido.')}
          </div>
          {profile.isPrivate && !isPrivate && <p className="mt-2 text-xs text-zinc-600">Ao passar a público, os pedidos pendentes são aceites.</p>}
        </div>
        <p role="alert" className="min-h-5 text-center text-sm text-red-600">{err}</p>
        <button disabled={busy || photoBusy} className={`${btnPrimary} w-full py-4 text-lg`}>{busy ? 'A guardar…' : 'Guardar'}</button>
      </form>
    </Sheet>
  );
}
