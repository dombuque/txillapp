import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tr, locale } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import CameraCapture from '../components/CameraCapture';
import { LoadingBlock } from '../components/Loading';
import Icon from '../components/Icon';
import StackPage from '../components/StackPage';
import VerifiedBadge from '../components/VerifiedBadge';
import { btnGhost, btnPrimary, fieldInput } from '../components/ui';
import { api, type DocType } from '../lib/api';

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'id_card', label: 'BI ou cartão de eleitor' },
  { value: 'passport', label: 'Passaporte' },
  { value: 'driver_licence', label: 'Carta de condução' },
  { value: 'residence', label: 'DIRE (residente)' },
  { value: 'other', label: 'Outro documento oficial com foto' },
];

/** Uma foto a enviar. Com `live`, só se aceita uma foto tirada na hora (câmara); senão também se escolhe da galeria. */
function PhotoSlot({ label, hint, file, onPick, live, liveHint }: { label: string; hint: string; file: File | null; onPick: (f: File) => void; live?: boolean; liveHint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [cam, setCam] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function take(f: File) {
    setPreview(URL.createObjectURL(f));
    onPick(f);
  }
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold">{label}</p>
      <button type="button" onClick={() => (live ? setCam(true) : input.current?.click())} className="flex h-36 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 active:bg-zinc-100">
        {preview && file ? <img src={preview} alt={label} className="h-full w-full object-cover" /> : (
          <span className="flex flex-col items-center gap-1 px-4 text-center text-sm"><Icon name="camera" size={28} />{hint}</span>
        )}
      </button>
      {preview && live && <button type="button" onClick={() => setCam(true)} className="mt-1.5 text-sm font-semibold text-brand">{tr('Tirar outra vez')}</button>}
      {!live && <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) take(f); }} />}
      {cam && <CameraCapture title={label} hint={liveHint ?? hint} onTake={(f) => { setCam(false); take(f); }} onClose={() => setCam(false)} />}
    </div>
  );
}

/** Pedir o selo de verificado: requisitos automáticos primeiro; depois documento (frente e verso), leitura da cara, selfie ao lado do documento e a justificação, para revisão manual. */
export default function Verification() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['verification'], queryFn: api.verificationStatus });
  const [kind, setKind] = useState<'person' | 'business'>('person');
  const [docType, setDocType] = useState<DocType>('id_card');
  const [fullName, setFullName] = useState('');
  const [proof, setProof] = useState('');
  const [doc, setDoc] = useState<File | null>(null);
  const [docBack, setDocBack] = useState<File | null>(null);
  const [face, setFace] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const s = q.data;
  const twoSides = docType !== 'passport';
  const ready = !!fullName.trim() && proof.trim().length >= 30 && !!doc && (!twoSides || !!docBack) && !!face && !!selfie;

  async function submit() {
    if (!doc || !face || !selfie || (twoSides && !docBack)) return setErr(tr('Faltam fotos: documento, cara e selfie com o documento'));
    setBusy(true);
    setErr('');
    try {
      const docMediaId = await api.uploadChatFile(doc, doc.type);
      const docBackMediaId = twoSides && docBack ? await api.uploadChatFile(docBack, docBack.type) : undefined;
      const faceMediaId = await api.uploadChatFile(face, face.type);
      const selfieMediaId = await api.uploadChatFile(selfie, selfie.type);
      await api.verificationRequest({ kind, fullName: fullName.trim(), proof: proof.trim(), docType, docMediaId, docBackMediaId, faceMediaId, selfieMediaId });
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
      <div className="px-5 pb-12 pt-4">
        {q.isLoading && <LoadingBlock />}
        {s && s.verified && (
          <div className="rounded-3xl bg-sky-50 p-6 text-center">
            <VerifiedBadge size={56} tier={s.tier} />
            <p className="mt-3 text-xl font-extrabold">{s.tier === 'official' ? tr('Conta oficial do Txillapp') : s.tier === 'paid' ? tr('A tua conta está verificada com subscrição') : tr('A tua conta está verificada')}</p>
            <p className="mt-1 text-sm text-zinc-600">{tr('O selo aparece junto ao teu nome em todo o Txillapp.')}</p>
          </div>
        )}
        {s && !s.verified && (
          <>
            <p className="text-[15px] text-zinc-700">{tr('O selo mostra que uma conta é de quem diz ser. Passa por duas fases: primeiro a conta tem de cumprir os requisitos; depois a moderação revê o teu documento, a tua cara e a justificação.')}</p>

            <ul className="mt-4 divide-y divide-zinc-100 rounded-2xl border border-zinc-200">
              {s.items.map((i) => (
                <li key={i.key} className="flex items-start gap-3 px-4 py-3">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${i.ok ? 'bg-emerald-500 text-white' : 'bg-zinc-200 text-zinc-500'}`} aria-hidden><Icon name={i.ok ? 'check' : 'clock'} size={14} strokeWidth={3} /></span>
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
              <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mt-6 space-y-5">
                <div role="radiogroup" aria-label={tr('Tipo de conta')} className="grid grid-cols-2 gap-2">
                  {([['person', 'Pessoa'], ['business', 'Negócio ou marca']] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={kind === v} onClick={() => setKind(v)} className={`h-12 rounded-2xl border-2 text-sm font-semibold ${kind === v ? 'border-brand bg-rose-50 text-brand' : 'border-zinc-200 text-zinc-800'}`}>{tr(label)}</button>
                  ))}
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">{kind === 'person' ? tr('Nome completo (como no documento)') : tr('Nome do negócio ou do responsável')}</span>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} required className={fieldInput} />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex justify-between text-sm font-semibold"><span>{tr('Justifica o pedido')}</span><span className={proof.trim().length < 30 ? 'text-zinc-500' : 'text-emerald-600'}>{proof.trim().length}/600</span></span>
                  <textarea value={proof} onChange={(e) => setProof(e.target.value)} maxLength={600} required rows={4} placeholder={tr('Quem és, o que fazes, porque precisas do selo e onde te podemos confirmar (página oficial, notícias, redes). Mínimo 30 caracteres.')} className={`${fieldInput} resize-none`} />
                </label>

                <div>
                  <p className="mb-1.5 text-sm font-semibold">{tr('Documento de identificação')}</p>
                  <p className="mb-2 text-sm text-zinc-500">{tr('Não tem de ser o BI: serve qualquer documento oficial com a tua foto.')}</p>
                  <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)} aria-label={tr('Tipo de documento')} className={fieldInput}>
                    {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{tr(d.label)}</option>)}
                  </select>
                </div>
                <PhotoSlot label={twoSides ? tr('Documento: frente') : tr('Passaporte: página da foto')} hint={tr('Toca para escolher ou tirar a foto. Os dados têm de estar legíveis.')} file={doc} onPick={setDoc} />
                {twoSides && <PhotoSlot label={tr('Documento: verso')} hint={tr('Toca para escolher ou tirar a foto do verso.')} file={docBack} onPick={setDocBack} />}
                <PhotoSlot live label={tr('Leitura da cara')} hint={tr('Abre a câmara: olha de frente, com boa luz, sem óculos escuros nem boné.')} liveHint={tr('Põe a cara dentro do círculo, de frente e com boa luz.')} file={face} onPick={setFace} />
                <PhotoSlot live label={tr('Selfie ao lado do documento')} hint={tr('Abre a câmara: segura o documento ao lado da cara, com os dados e a foto visíveis.')} liveHint={tr('Cara e documento na mesma foto, com os dados legíveis.')} file={selfie} onPick={setSelfie} />

                {err && <p role="alert" className="text-center text-sm text-red-600">{err}</p>}
                <button disabled={busy || !ready} className={`${btnPrimary} w-full`}>{busy ? tr('A enviar…') : tr('Enviar pedido')}</button>
                <p className="text-center text-xs text-zinc-500">{tr('Só a moderação vê as fotos, e são apagadas quando decidirmos.')}</p>
              </form>
            )}
            {!s.eligible && <p className="mt-4 text-center text-sm text-zinc-500">{tr('Quando cumprires todos os pontos, o pedido abre aqui.')}</p>}
          </>
        )}
      </div>
    </StackPage>
  );
}
