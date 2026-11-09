import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type BoVenue } from '../../lib/api';
import { Badge, Empty, PageHeader, btnDanger, btnGhost, btnPrimary, td, th, useCan, when } from './bo';

const KIND: Record<string, string> = { bar: 'Bar', restaurante: 'Restaurante', discoteca: 'Discoteca', cafe: 'Café', hotel: 'Hotel', evento: 'Evento', outro: 'Outro' };

/** Motivos mais comuns para recusar (o dono vê o texto e pode corrigir). */
const REASONS = ['Falta a morada ou a cidade', 'O nome não corresponde a um local real', 'Parece duplicado de outro local', 'Fotos ou descrição impróprias', 'Não parece ser do dono do local'];

const REVIEW: Record<BoVenue['reviewStatus'], [string, 'amber' | 'green' | 'red']> = {
  pending: ['em análise', 'amber'],
  approved: ['aprovado', 'green'],
  rejected: ['recusado', 'red'],
};

/**
 * Os locais (bares, restaurantes…). Cada local novo fica em análise até a equipa o aprovar: só então aparece na pesquisa,
 * no mapa, recebe pagamentos, check-ins e publica como o local. Recusar leva um motivo que o dono vê; se ele corrigir,
 * o local volta à fila. O selo de verificado é à parte (confirma que é mesmo do dono). Tudo fica no registo de auditoria.
 */
export default function BackofficeVenues() {
  const qc = useQueryClient();
  const can = useCan('catalog.manage');
  const [filter, setFilter] = useState<'pending' | 'unverified' | 'all'>('pending');
  const q = useQuery({ queryKey: ['bo-venues', filter], queryFn: () => api.boVenues(filter) });
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const rows = q.data ?? [];

  async function run(slug: string, f: () => Promise<unknown>) {
    setBusy(slug);
    setErr('');
    try {
      await f();
      setRejecting(null);
      setNote('');
    } catch (e) {
      setErr((e as Error).message || 'Não consegui guardar');
    }
    await qc.invalidateQueries({ queryKey: ['bo-venues'] });
    setBusy(null);
  }

  return (
    <div>
      <PageHeader title="Locais" description="Bares, restaurantes, discotecas… Aprova os locais novos antes de ficarem públicos. O selo confirma que é mesmo do dono." />
      <div className="mb-4 flex flex-wrap gap-2">
        {([['pending', 'Por aprovar'], ['unverified', 'Sem selo'], ['all', 'Todos']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`${btnGhost} ${filter === k ? '!bg-zinc-900 !text-white' : ''}`}>{label}</button>
        ))}
      </div>
      {err ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p> : null}
      {q.isLoading && <p className="text-sm text-zinc-500">A carregar…</p>}
      {q.isSuccess && rows.length === 0 && <Empty title={filter === 'pending' ? 'Nada por aprovar' : filter === 'unverified' ? 'Todos têm selo' : 'Ainda não há locais'} />}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-zinc-200/70">
          <table className="w-full">
            <thead><tr><th className={th}>Local</th><th className={th}>Tipo</th><th className={th}>Dono</th><th className={th}>Contactos</th><th className={th}>Criado</th><th className={th}>Estado</th><th className={th} /></tr></thead>
            <tbody>
              {rows.map((v) => {
                const [label, tone] = REVIEW[v.reviewStatus] ?? REVIEW.pending;
                return (
                  <tr key={v.slug} className="border-t border-zinc-100 align-top">
                    <td className={td}>
                      <span className="font-semibold">{v.name}</span>
                      <span className="block text-xs text-zinc-500">{[v.address, v.city].filter(Boolean).join(' · ') || 'sem morada'}</span>
                      {v.about ? <span className="mt-1 block max-w-md text-xs text-zinc-600">{v.about}</span> : null}
                      {v.reviewStatus === 'rejected' && v.reviewNote ? <span className="mt-1 block text-xs text-red-700">Motivo: {v.reviewNote}</span> : null}
                    </td>
                    <td className={td}>{KIND[v.kind] ?? v.kind}</td>
                    <td className={td}>@{v.owner}</td>
                    <td className={`${td} text-xs`}>
                      {v.phone ? <span className="block">{v.phone}</span> : null}
                      {v.website ? <a href={v.website} target="_blank" rel="noreferrer" className="block underline">{v.website.replace(/^https?:\/\//, '')}</a> : null}
                      {!v.phone && !v.website ? <span className="text-zinc-400">nenhum</span> : null}
                    </td>
                    <td className={td}>{when(v.createdAt)}</td>
                    <td className={td}>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={tone}>{label}</Badge>
                        {v.reviewStatus === 'approved' ? <Badge tone={v.verified ? 'green' : 'zinc'}>{v.verified ? 'com selo' : 'sem selo'}</Badge> : null}
                      </div>
                    </td>
                    <td className={`${td} text-right`}>
                      {can && rejecting === v.slug ? (
                        <div className="flex min-w-[260px] flex-col items-stretch gap-2 text-left">
                          <select value={REASONS.includes(note) ? note : ''} onChange={(e) => setNote(e.target.value)} className="h-9 rounded-lg border border-zinc-300 px-2 text-sm">
                            <option value="">Escolhe um motivo…</option>
                            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder="Ou escreve o motivo (o dono vê isto)" className="rounded-lg border border-zinc-300 px-2 py-1 text-sm" />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => { setRejecting(null); setNote(''); }} className={btnGhost}>Cancelar</button>
                            <button disabled={busy === v.slug || !note.trim()} onClick={() => void run(v.slug, () => api.boReviewVenue(v.slug, 'rejected', note.trim()))} className={btnDanger}>Recusar</button>
                          </div>
                        </div>
                      ) : can ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          {v.reviewStatus !== 'approved' && (
                            <button disabled={busy === v.slug} onClick={() => void run(v.slug, () => api.boReviewVenue(v.slug, 'approved'))} className={btnPrimary}>Aprovar</button>
                          )}
                          {v.reviewStatus !== 'rejected' && (
                            <button disabled={busy === v.slug} onClick={() => { setRejecting(v.slug); setNote(''); }} className={btnGhost}>{v.reviewStatus === 'approved' ? 'Retirar' : 'Recusar'}</button>
                          )}
                          {v.reviewStatus === 'approved' && (v.verified
                            ? <button disabled={busy === v.slug} onClick={() => void run(v.slug, () => api.boVerifyVenue(v.slug, false))} className={btnDanger}>Tirar o selo</button>
                            : <button disabled={busy === v.slug} onClick={() => void run(v.slug, () => api.boVerifyVenue(v.slug, true))} className={btnGhost}>Dar selo</button>)}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
