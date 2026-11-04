import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { shareNow, profileShare } from '../lib/share';
import Icon from './Icon';
import { Sheet } from './ui';

const INK = '#18181b';

/** Desenha o cartão do QR (para guardar como imagem): fundo branco, QR, o nome e a marca. */
async function cardPng(url: string, username: string): Promise<Blob | null> {
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, url, { width: 720, margin: 1, errorCorrectionLevel: 'M', color: { dark: INK, light: '#ffffff' } });
  const W = 900;
  const H = 1100;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.drawImage(qr, (W - 720) / 2, 80, 720, 720);
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.font = '800 54px system-ui, sans-serif';
  g.fillText(`@${username}`, W / 2, 900);
  g.fillStyle = '#d6334f';
  g.beginPath();
  g.arc(W / 2 - 92, 996, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
  g.font = '800 46px system-ui, sans-serif';
  g.fillText('txillapp', W / 2, 1020);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

/** Partilhar o perfil com um QR: quem o lê abre o teu perfil. Também se partilha a ligação ou guarda a imagem. */
export default function ProfileQrSheet({ username, displayName, onClose }: { username: string; displayName: string; onClose: () => void }) {
  const url = `${window.location.origin}/u/${username}`;
  const [src, setSrc] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(url, { width: 520, margin: 1, errorCorrectionLevel: 'M', color: { dark: INK, light: '#ffffff' } }).then((d) => live && setSrc(d));
    return () => { live = false; };
  }, [url]);
  const flash = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(''), 2000);
  };
  async function share() {
    const r = await shareNow(profileShare(displayName, username, window.location.origin));
    if (r === 'copied') flash(tr('Texto e link copiados'));
    if (r === 'failed') flash(tr('Não consegui copiar'));
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      flash(tr('Ligação copiada'));
    } catch {
      flash(tr('Não consegui copiar'));
    }
  }
  async function save() {
    const blob = await cardPng(url, username);
    if (!blob) return flash(tr('Não consegui guardar'));
    const file = new File([blob], `txillapp-${username}.png`, { type: 'image/png' });
    // No telemóvel abre o menu (guardar nas fotos); no computador descarrega.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const btn = 'flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-zinc-100 px-3 text-[15px] font-bold text-zinc-900 transition active:scale-95';
  return (
    <Sheet title={tr('Partilhar perfil')} onClose={onClose}>
      <div className="mx-auto flex w-full max-w-[300px] flex-col items-center rounded-3xl bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.12)] ring-1 ring-zinc-100">
        {src ? <img src={src} alt={tr('QR do perfil de {v0}', { v0: username })} className="aspect-square w-full" /> : <div className="aspect-square w-full animate-pulse rounded-2xl bg-zinc-100" />}
        <p className="mt-3 text-xl font-extrabold">@{username}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-lg font-extrabold tracking-tight"><span aria-hidden className="h-2 w-2 rounded-full bg-brand" />txillapp</p>
      </div>
      <p className="mt-3 text-center text-sm text-zinc-600">{tr('Aponta a câmara ao QR para abrir o perfil.')}</p>
      <div className="mt-4 flex gap-2">
        <button onClick={() => void share()} className={btn}><Icon name="share" size={18} /> {tr('Partilhar')}</button>
        <button onClick={() => void copy()} className={btn}><Icon name="link" size={18} /> {tr('Copiar')}</button>
        <button onClick={() => void save()} className={btn}><Icon name="download" size={18} /> {tr('Guardar')}</button>
      </div>
      <p role="status" className="mt-2 min-h-5 text-center text-sm font-semibold text-zinc-700">{note}</p>
    </Sheet>
  );
}
