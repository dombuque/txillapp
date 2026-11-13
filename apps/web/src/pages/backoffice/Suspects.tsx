import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Empty, PageHeader, ReasonDialog, ago, btnDanger, btnGhost, btnPrimary, statusBadge, useCan, when } from './bo';
import { ContasError, ContasLoading, ContasTabs } from './ui/contas-ui';
import { RISK_TABS, riskApi, scoreTone, type RiskDecision, type RiskItem, type RiskState } from './ui/risk-api';

const DECISIONS: Record<RiskDecision, { title: string; help: string; confirm: string; danger?: boolean }> = {
  clear: {
    title: 'É uma conta verdadeira',
    help: 'Sai da fila, os limites acabam e os sinais deixam de a pôr cá outra vez. Os convites dela voltam a contar.',
    confirm: 'Confirmar como verdadeira',
  },
  limit: {
    title: 'Limitar durante 7 dias',
    help: 'Sem mensagens a quem não a segue, poucos «seguir» e pedidos de gelada, e sem enviar Txills. Os convites ficam à espera.',
    confirm: 'Limitar 7 dias',
  },
  suspend: {
    title: 'Suspender a conta',
    help: 'A conta deixa de poder entrar e as sessões terminam. Os convites nunca dão prémio. Pode ser reativada na ficha.',
    confirm: 'Suspender',
    danger: true,
  },
};

const clientLabel = (c: RiskItem['client']) => (c === 'app' ? 'app nativa' : c === 'web' ? 'browser' : 'outro');

/**
 * Backoffice › Contas suspeitas: as contas novas que a pontuação de risco marcou (mesmo aparelho ou IP, nomes gerados,
 * ações em rajada…). Ficam 24 horas com limites apertados à espera de uma decisão: verdadeira, limitar ou suspender.
 * Nunca mostra IP nem email: só quantas outras contas partilham o IP, o aparelho ou o email.
 */
export default function BackofficeSuspects() {
  const [params, setParams] = useSearchParams();
  const state = (RISK_TABS.some((t) => t.id === params.get('estado')) ? params.get('estado') : 'flagged') as RiskState;
  const canDecide = useCan('users.suspend');
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ item: RiskItem; decision: RiskDecision } | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['bo-risk', state],
    queryFn: ({ pageParam }) => riskApi.queue(state, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = list.data?.pages[0]?.counts;

  async function decide(reason: string) {
    if (!dialog) return;
    await riskApi.decide(dialog.item.user.id, dialog.decision, reason);
    setDialog(null);
    void qc.invalidateQueries({ queryKey: ['bo-risk'] });
    void qc.invalidateQueries({ queryKey: ['bo-accounts'] });
  }

  return (
    <>
      <PageHeader
        title="Contas suspeitas"
        description="Contas novas com pontuação de risco alta (de 0 a 100). Ficam 24 horas sem escrever a desconhecidos nem enviar Txills, à espera de uma decisão. Cada decisão fica no registo."
      />
      <ContasTabs
        tabs={RISK_TABS.map((t) => ({ ...t, count: counts?.[t.id] }))}
        value={state}
        onChange={(t) => setParams(t === 'flagged' ? {} : { estado: t }, { replace: true })}
      />
      <div className="mt-4 space-y-3">
        {list.isLoading && <ContasLoading rows={4} label="A carregar as contas suspeitas" />}
        {list.isError && <ContasError error={list.error} onRetry={() => void list.refetch()} title="Não foi possível carregar a fila" />}
        {list.isSuccess && rows.length === 0 && (
          <Empty title={state === 'flagged' ? 'Nada por rever' : 'Nenhuma conta aqui'} text={state === 'flagged' ? 'Quando uma conta nova parecer automática ou falsa, aparece aqui.' : undefined} />
        )}
        {rows.map((r) => (
          <article key={r.user.id} className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/backoffice/users/${r.user.id}`} className="font-bold text-zinc-900 underline-offset-2 hover:underline">@{r.user.username}</Link>
                  <span className="truncate text-sm text-zinc-500">{r.user.displayName}</span>
                  {statusBadge(r.user.status)}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Criada {ago(r.user.createdAt)} · {clientLabel(r.client)}{r.human ? ' · passou a prova de humano' : ''} · email {r.user.emailDomain ? `@${r.user.emailDomain}` : '—'} {r.user.emailVerified ? '(confirmado)' : '(por confirmar)'}
                </p>
              </div>
              <div className="text-right">
                <Badge tone={scoreTone(r.score)}>risco {r.score}</Badge>
                {r.limitedUntil && new Date(r.limitedUntil) > new Date() && <p className="mt-1 text-xs text-zinc-500">limitada até {when(r.limitedUntil)}</p>}
              </div>
            </div>

            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Sinais">
              {r.signals.map((s) => (
                <li key={s.id} className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">{s.label} <span className="font-bold tabular-nums">+{s.points}</span></li>
              ))}
            </ul>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-zinc-500">Outras no mesmo IP</dt><dd className="font-semibold tabular-nums">{r.related.sameIp}</dd></div>
              <div><dt className="text-xs text-zinc-500">No mesmo aparelho</dt><dd className="font-semibold tabular-nums">{r.related.sameDevice}</dd></div>
              <div><dt className="text-xs text-zinc-500">Com o mesmo email</dt><dd className="font-semibold tabular-nums">{r.related.sameEmail}</dd></div>
              <div><dt className="text-xs text-zinc-500">Convidada por</dt><dd className="font-semibold">{r.activity.invitedBy ? `@${r.activity.invitedBy}` : '—'}</dd></div>
              <div><dt className="text-xs text-zinc-500">Segue</dt><dd className="font-semibold tabular-nums">{r.activity.following}</dd></div>
              <div><dt className="text-xs text-zinc-500">Publicações</dt><dd className="font-semibold tabular-nums">{r.activity.posts}</dd></div>
              <div><dt className="text-xs text-zinc-500">Mensagens</dt><dd className="font-semibold tabular-nums">{r.activity.messages}</dd></div>
              <div><dt className="text-xs text-zinc-500">Queixas recebidas</dt><dd className="font-semibold tabular-nums">{r.activity.reports}</dd></div>
            </dl>

            {r.reviewedAt && <p className="mt-3 text-xs text-zinc-500">Decidido {ago(r.reviewedAt)}{r.reviewNote ? `: «${r.reviewNote}»` : ''}</p>}

            {canDecide && r.user.status !== 'deleted' && (
              <div className="mt-4 flex flex-wrap gap-2">
                {r.state !== 'cleared' && <button type="button" className={btnPrimary} onClick={() => setDialog({ item: r, decision: 'clear' })}>É verdadeira</button>}
                {r.state !== 'suspended' && <button type="button" className={btnGhost} onClick={() => setDialog({ item: r, decision: 'limit' })}>Limitar 7 dias</button>}
                {r.state !== 'suspended' && r.user.status === 'active' && <button type="button" className={btnDanger} onClick={() => setDialog({ item: r, decision: 'suspend' })}>Suspender</button>}
              </div>
            )}
          </article>
        ))}
        {list.hasNextPage && (
          <div className="flex justify-center pt-2">
            <button type="button" className={btnGhost} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? 'A carregar…' : 'Mostrar mais'}</button>
          </div>
        )}
      </div>

      {dialog && (
        <ReasonDialog
          title={`${DECISIONS[dialog.decision].title}: @${dialog.item.user.username}`}
          help={DECISIONS[dialog.decision].help}
          confirm={DECISIONS[dialog.decision].confirm}
          danger={DECISIONS[dialog.decision].danger}
          onCancel={() => setDialog(null)}
          onConfirm={decide}
        />
      )}
    </>
  );
}
