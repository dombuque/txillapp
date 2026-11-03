import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tr, locale } from '../lib/i18n';
import { useRef, useState } from 'react';
import { LoadingBlock } from '../components/Loading';
import Icon from '../components/Icon';
import StackPage from '../components/StackPage';
import VerifiedBadge from '../components/VerifiedBadge';
import { btnGhost, btnPrimary, fieldInput } from '../components/ui';
import { api } from '../lib/api';

/** Uma foto a enviar (documento ou selfie): mostra a miniatura e deixa trocar. */
function PhotoSlot({ label, hint, file, onPick }: { label: string; hint: string; file: File | null; onPick: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold">{label}</p>
      <button type="button" onClick={() => input.current?.click()} className="flex h-36 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 transition active:scale-[0.99]">
        {preview && file ? <img src={preview} alt={label} className="h-full w-full object-cover" /> : (
          <span className="flex flex-col items-center gap-1 px-4 text-center text-sm"><Icon name="camera" size={28} />{hint}</span>
        )}
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (preview) URL.revokeObjectURL(preview);
        setPreview(URL.createObjectURL(f));
        onPick(f);
      }} />
    </div>
  );
}

/** Pedir o selo de verificado: requisitos automáticos primeiro, depois nome, prova, documento e selfie para revisão manual. */
export default function Verification() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['verification'], queryFn: api.verificationStatus });
  const [kind, setKind] = useState<'person' | 'business'>('person');
  const [fullName, setFullName] = useState('');
  const [proof, setProof] = useState('');
  const [doc, setDoc] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const s = q.data;

  async function submit() {
    if (!doc || !selfie) return setErr('Envia o documento e a selfie');
    setBusy(true);
    setErr('');
    try {
      const [docMediaId, selfieMediaId] = [await api.uploadChatFile(doc, doc.type), await api.uploadChatFile(selfie, selfie.type)];
      await api.verificationRequest({ kind, fullName: fullName.trim(), proof: proof.trim(), docMediaId, selfieMediaId });
      await qc.invalidateQueries({ queryKey: ['verification'] });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  async function withdraw() {
    setBusy(true);
    try {
      await api.verificationWithdraw();
      await qc.invalidateQueries({ queryKey: ['verification'] });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <StackPage title={tr('Verificação')}>
      <div className="px-5 pt-4">
        {q.isLoading && <LoadingBlock />}
        {s && s.verified && (
          <div className="rounded-3xl bg-sky-50 p-6 text-center">
            <VerifiedBadge size={56} tier={s.tier} />
            <p className="mt-3 text-xl font-extrabold">{s.tier === 'official' ? 'Conta oficial do Txillapp' : 'A tua conta está verificada'}</p>
            <p className="mt-1 text-sm text-zinc-600">{tr('O selo aparece junto ao teu nome em todo o Txillapp.')}</p>
          </div>
        )}
        {s && !s.verified && (
          <>
            <p className="text-[15px] text-zinc-700">{tr('O selo mostra que uma conta é de quem diz ser. Passa por duas fases: primeiro a conta tem de cumprir os requisitos, depois revemos o teu documento à mão. Os documentos são apagados logo que há decisão.')}</p>

            <ul className="mt-4 divide-y divide-zinc-100 rounded-2xl border border-zinc-200">
              {s.items.map((i) => (
                <li key={i.key} className="flex items-start gap-3 px-4 py-3">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${i.ok ? 'bg-emerald-500 text-white' : 'bg-zinc-200 text-zinc-500'}`} aria-hidden><Icon name={i.ok ? 'check' : 'x'} size={14} strokeWidth={3} /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{i.label}</span>
                    {!i.ok && <span className="block text-sm text-zinc-500">{i.hint}</span>}
                  </span>
                </li>
              ))}
            </ul>

            {s.request?.status === 'pending' && (
              <div className="mt-5 rounded-2xl bg-amber-50 p-4">
                <p className="font-bold">{tr('Pedido em análise')}</p>
                <p className="mt-1 text-sm text-zinc-700">{tr('Vamos rever o teu pedido e avisamos-te quando houver decisão.')}</p>
                <button onClick={withdraw} disabled={busy} className={`${btnGhost} mt-3 !py-2.5`}>{tr('Retirar pedido')}</button>
              </div>
            )}
            {s.request?.status === 'rejected' && (
              <div className="mt-5 rounded-2xl bg-red-50 p-4">
                <p className="font-bold">{tr('O último pedido foi recusado')}</p>
                {s.request.reason && <p className="mt-1 text-sm text-zinc-700">{tr('Motivo:')} {s.request.reason}</p>}
                {s.retryAfter && <p className="mt-1 text-sm text-zinc-600">{tr('Podes pedir outra vez a partir de')} {new Date(s.retryAfter).toLocaleDateString(locale)}.</p>}
              </div>
            )}

            {s.eligible && s.request?.status !== 'pending' && !s.retryAfter && (
              <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mt-6 space-y-4">
                <div role="radiogroup" aria-label={tr('Tipo de conta')} className="grid grid-cols-2 gap-2">
                  {([['person', 'Pessoa'], ['business', 'Negócio ou marca']] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={kind === v} onClick={() => setKind(v)} className={`h-12 rounded-2xl border-2 text-sm font-semibold ${kind === v ? 'border-brand bg-rose-50' : 'border-zinc-200'}`}>{label}</button>
                  ))}
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">{kind === 'person' ? 'Nome completo (como no documento)' : 'Nome do negócio ou do responsável'}</span>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} required className={fieldInput} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">{tr('Quem és e onde te podemos confirmar')}</span>
                  <textarea value={proof} onChange={(e) => setProof(e.target.value)} maxLength={600} minLength={10} required rows={3} placeholder={tr('Ex.: músico, página oficial em… ou notícia sobre mim em…')} className={`${fieldInput} resize-none`} />
                </label>
                <PhotoSlot label={tr('Documento de identificação')} hint={tr('BI, passaporte ou carta de condução (a frente)')} file={doc} onPick={setDoc} />
                <PhotoSlot label={tr('Selfie')} hint={tr('Uma foto tua, com a cara bem visível')} file={selfie} onPick={setSelfie} />
                {err && <p role="alert" className="text-center text-sm text-red-600">{err}</p>}
                <button disabled={busy || !fullName.trim() || proof.trim().length < 10 || !doc || !selfie} className={`${btnPrimary} w-full`}>{busy ? 'A enviar…' : 'Enviar pedido'}</button>
                <p className="text-center text-xs text-zinc-500">{tr('Só a moderação vê os documentos, e são apagados quando decidirmos.')}</p>
              </form>
            )}
            {!s.eligible && <p className="mt-4 text-center text-sm text-zinc-500">{tr('Quando cumprires todos os pontos, o pedido abre aqui.')}</p>}
          </>
        )}
      </div>
    </StackPage>
  );
}
