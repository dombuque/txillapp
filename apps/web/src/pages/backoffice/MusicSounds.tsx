import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadingBlock } from '../../components/Loading';
import { Badge, Card, Empty, ReasonDialog, ago, btnDanger, btnGhost } from './bo';
import { mmss, soundsAdminApi, type SoundReportFilter, type SoundReportItem } from './ui/music-api';

type Ask = { title: string; help: string; confirm: string; danger?: boolean; run: (reason: string) => Promise<void> };

const FILTERS: readonly (readonly [SoundReportFilter, string])[] = [['open', 'Por decidir'], ['upheld', 'Com razão'], ['dismissed', 'Sem razão'], ['all', 'Todos']];
const STATUS: Record<SoundReportItem['status'], { label: string; tone: 'amber' | 'red' | 'green' }> = {
  held: { label: 'Escondido para novos usos', tone: 'amber' },
  removed: { label: 'Tirado', tone: 'red' },
  active: { label: 'Disponível', tone: 'green' },
};

/**
 * Backoffice › Música › Sons originais (docs/sons.md): os sons tirados das tchekas que foram denunciados («Este som tem música
 * protegida»). Enquanto há uma denúncia por decidir, o som não se pode usar em tchekas novas (continua a tocar nas que já o
 * usam). Dar razão tira o som de todo o lado; o vídeo de onde saiu fica (a Moderação tira-o à parte, se for preciso).
 */
export function MusicSoundsPanel({ can }: { can: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SoundReportFilter>('open');
  const [asking, setAsking] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: ['bo-music', 'sounds', status], queryFn: () => soundsAdminApi.list(status) });
  const done = () => void qc.invalidateQueries({ queryKey: ['bo-music', 'sounds'] });
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={status === id} onClick={() => setStatus(id)}
            className={`h-8 rounded-full px-3.5 text-sm font-semibold transition ${status === id ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50'}`}>
            {label}
          </button>
        ))}
      </div>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <p role="alert" className="text-center text-red-600">Não foi possível carregar.</p> : !q.data?.length ? <Empty title="Sem sons denunciados aqui." /> : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {q.data.map((s) => (
            <li key={s.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    {s.cover && <img src={s.cover} alt="" className="h-16 w-12 rounded-lg object-cover" />}
                    <div>
                      <p className="text-lg font-bold text-zinc-900">{s.title}</p>
                      {s.owner ? <Link to={`/backoffice/users/${s.owner.id}`} className="text-sm font-semibold text-brand">@{s.owner.username}</Link> : <span className="text-sm text-zinc-500">conta eliminada</span>}
                      <span className="text-sm text-zinc-500"> · {s.uses} {s.uses === 1 ? 'tcheka' : 'tchekas'}{s.durationMs ? ` · ${mmss(s.durationMs)}` : ''}</span>
                    </div>
                  </div>
                  <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                </div>
                {s.previewUrl && s.status !== 'removed' && <audio controls preload="none" src={s.previewUrl} className="mt-3 w-full" />}
                {s.post && <p className="mt-2 text-sm text-zinc-600">Tcheka de onde saiu: <a href={`/p/${s.post.code}`} target="_blank" rel="noreferrer" className="font-semibold text-brand">/p/{s.post.code}</a>{s.post.removed ? ' (apagada)' : ''}</p>}
                {s.removedReason && <p className="mt-1 text-sm text-zinc-600"><span className="font-semibold text-zinc-800">Motivo:</span> {s.removedReason}</p>}
                <ul className="mt-3 space-y-2">
                  {s.reports.map((r, i) => (
                    <li key={i} className="rounded-xl bg-zinc-50 p-3 text-sm text-zinc-800">
                      <span className="font-semibold">{r.reason === 'copyright' ? 'Música protegida' : 'Outro motivo'}</span> · {ago(r.at)}
                      {r.status !== 'open' && <span className="text-zinc-500"> · {r.status === 'upheld' ? 'com razão' : 'sem razão'}{r.decisionReason ? `: ${r.decisionReason}` : ''}</span>}
                      {r.note && <p className="mt-1 whitespace-pre-wrap break-words">{r.note}</p>}
                    </li>
                  ))}
                </ul>
                {can && (
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {s.open > 0 && s.status !== 'removed' && (
                      <>
                        <button type="button" className={btnGhost}
                          onClick={() => setAsking({ title: 'Não dar razão', help: 'O som volta a poder ser usado em tchekas novas.', confirm: 'Não dar razão', run: (r) => soundsAdminApi.decide(s.id, 'dismiss', r) })}>Não dar razão</button>
                        <button type="button" className={btnDanger}
                          onClick={() => setAsking({ title: 'Dar razão: tirar o som', help: 'O som sai de vez e deixa de tocar em todas as tchekas que o usam. O vídeo de onde saiu fica; se for preciso, tira-o na Moderação.', confirm: 'Tirar o som', danger: true, run: (r) => soundsAdminApi.decide(s.id, 'uphold', r) })}>Dar razão</button>
                      </>
                    )}
                    {s.status === 'removed' && s.owner?.status === 'active' && (
                      <button type="button" className={btnGhost}
                        onClick={() => setAsking({ title: 'Repor o som', help: 'Volta a tocar e a poder ser usado (se o autor deixar).', confirm: 'Repor', run: (r) => soundsAdminApi.decide(s.id, 'restore', r) })}>Repor</button>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <ReasonDialog title={asking.title} help={asking.help} confirm={asking.confirm} danger={asking.danger} onCancel={() => setAsking(null)}
          onConfirm={async (reason) => { await asking.run(reason); setAsking(null); done(); }} />
      )}
    </>
  );
}
