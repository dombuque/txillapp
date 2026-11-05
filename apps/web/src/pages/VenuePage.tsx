import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { LoadingBlock } from '../components/Loading';
import PostCard from '../components/PostCard';
import StackPage from '../components/StackPage';
import VerifiedBadge from '../components/VerifiedBadge';
import { api, type Venue } from '../lib/api';
import { tr } from '../lib/i18n';

export const KIND_LABEL: Record<string, string> = { bar: 'Bar', restaurante: 'Restaurante', discoteca: 'Discoteca', cafe: 'Café', hotel: 'Hotel', evento: 'Evento', outro: 'Outro' };

/** Cartão do QR do local (para o dono imprimir): quem o lê, no local, faz check-in. */
function OwnerQr({ venue }: { venue: Venue }) {
  const qc = useQueryClient();
  const url = `${window.location.origin}/v/${venue.slug}?k=${venue.qrToken}`;
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(url, { width: 520, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#18181b', light: '#ffffff' } }).then((d) => live && setSrc(d));
    return () => { live = false; };
  }, [url]);

  async function save() {
    const qr = document.createElement('canvas');
    await QRCode.toCanvas(qr, url, { width: 720, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#18181b', light: '#ffffff' } });
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1180;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 900, 1180);
    g.drawImage(qr, 90, 150, 720, 720);
    g.fillStyle = '#18181b';
    g.textAlign = 'center';
    g.font = '800 46px system-ui, sans-serif';
    g.fillText(tr('Faz check-in no Txillapp'), 450, 100);
    g.font = '800 58px system-ui, sans-serif';
    g.fillText(venue.name.slice(0, 26), 450, 960);
    g.fillStyle = '#d6334f';
    g.beginPath();
    g.arc(366, 1100, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#18181b';
    g.font = '800 46px system-ui, sans-serif';
    g.fillText('txillapp', 450, 1118);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `txillapp-${venue.slug}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function rotate() {
    if (!window.confirm(tr('Mudar o QR? O QR impresso deixa de funcionar e tens de imprimir o novo.'))) return;
    setBusy(true);
    await api.rotateVenueQr(venue.slug).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['venue', venue.slug] });
    setBusy(false);
  }
  return (
    <section className="mx-4 mt-4 rounded-3xl bg-white p-4 shadow-[0_2px_16px_rgba(0,0,0,0.09)]" aria-label={tr('QR do local')}>
      <p className="font-extrabold">{tr('O QR do teu local')}</p>
      <p className="mt-0.5 text-sm text-zinc-600">{tr('Imprime-o e põe-no no local. Quem o ler faz check-in. Só tu vês este QR.')}</p>
      <div className="mx-auto mt-3 w-full max-w-[240px]">
        {src ? <img src={src} alt={tr('QR do local {v0}', { v0: venue.name })} className="aspect-square w-full" /> : <div className="aspect-square w-full animate-pulse rounded-2xl bg-zinc-100" />}
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => void save()} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-zinc-900 text-[15px] font-bold text-white active:scale-95"><Icon name="download" size={18} /> {tr('Guardar para imprimir')}</button>
        <button onClick={() => void rotate()} disabled={busy} className="h-11 rounded-full bg-zinc-100 px-4 text-[15px] font-bold text-zinc-800 active:scale-95 disabled:opacity-60">{tr('Mudar o QR')}</button>
      </div>
    </section>
  );
}

/** A página de um local (bar, restaurante…): quem lá esteve, as publicações feitas ali e o check-in por QR. */
export default function VenuePage() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const token = params.get('k');
  const q = useQuery({ queryKey: ['venue', slug], queryFn: () => api.venue(slug), retry: false });
  const v = q.data;
  const posts = useInfiniteQuery({
    queryKey: ['venue-posts', v?.name],
    queryFn: ({ pageParam }) => api.placePosts(v!.name, 'at', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: !!v,
    retry: false,
  });
  const items = posts.data?.pages.flatMap((p) => p.items) ?? [];
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function checkin() {
    if (!token || !v) return;
    setBusy(true);
    setMsg('');
    try {
      await api.venueCheckin(slug, token);
      setParams({}, { replace: true });
      setMsg(tr('Check-in feito! Bom proveito.'));
      await qc.invalidateQueries({ queryKey: ['venue', slug] });
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <StackPage title={v?.name ?? tr('Local')}>
      {q.isLoading && <LoadingBlock className="py-16" />}
      {q.isError && <p role="alert" className="py-16 text-center text-zinc-600">{tr('Este local não existe')}</p>}
      {v && (
        <>
          <section className="mx-4 mt-4 rounded-3xl bg-white p-4 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
            <div className="flex items-start gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white"><Icon name="map-pin" size={26} /></span>
              <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-1.5 text-[22px] font-extrabold leading-tight">
                  <span className="truncate">{v.name}</span>
                  {v.verified && <VerifiedBadge size={18} tier="verified" />}
                </h2>
                <p className="text-sm text-zinc-600">{tr(KIND_LABEL[v.kind] ?? 'Outro')}{v.city ? ` · ${v.city}` : ''}</p>
              </div>
            </div>
            {v.about && <p className="mt-3 text-[15px] text-zinc-800">{v.about}</p>}
            <div className="mt-3 flex gap-6 text-sm text-zinc-600">
              <span><b className="text-lg text-zinc-900">{v.checkins}</b> {tr('check-ins')}</span>
              <span><b className="text-lg text-zinc-900">{v.checkinsToday}</b> {tr('nas últimas 24 h')}</span>
            </div>
            {!v.verified && v.mine && <p className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900">{tr('Em análise: a equipa do Txillapp vai verificar o teu local e dar-lhe o selo.')}</p>}

            {token && !v.checkedIn && (
              <button onClick={() => void checkin()} disabled={busy} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand font-bold text-white active:scale-[0.98] disabled:opacity-60">
                <Icon name="check-circle" size={20} /> {tr('Estou aqui: fazer check-in')}
              </button>
            )}
            {v.checkedIn && <p role="status" className="mt-4 flex h-12 items-center justify-center gap-2 rounded-full bg-zinc-100 font-bold text-zinc-800"><Icon name="check-circle" size={20} /> {tr('Já fizeste check-in aqui')}</p>}
            {!token && !v.checkedIn && <p className="mt-3 text-xs text-zinc-500">{tr('Para fazer check-in, lê o QR que está no local.')}</p>}
            {msg && <p role="status" className="mt-2 text-center text-sm font-semibold text-zinc-700">{msg}</p>}
          </section>

          {v.mine && v.qrToken && <OwnerQr venue={v} />}

          <h3 className="mx-5 mb-2 mt-6 text-lg font-extrabold">{tr('Publicações deste local')}</h3>
          {posts.isLoading && <LoadingBlock className="py-10" />}
          {posts.isSuccess && items.length === 0 && <p className="mx-6 py-8 text-center text-zinc-500">{tr('Ainda ninguém publicou aqui. Sê o primeiro e põe este local nos teus posts.')}</p>}
          {items.map((p) => <PostCard key={p.id} post={p} />)}
        </>
      )}
    </StackPage>
  );
}
