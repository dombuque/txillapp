import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { Badge, Empty, PageHeader, ago, btnGhost, statusBadge, td, th, useCan } from './bo';
import { contasApi, countryName, type AccountFilters, type AccountRow } from './ui/contas-api';
import { BadgeTier, ContasError, ContasLoading, ContasTable, FilterChip, MinorBadge, inputCls } from './ui/contas-ui';

const SORTS: [string, string][] = [
  ['recent', 'Registo: mais recentes'],
  ['oldest', 'Registo: mais antigas'],
  ['last_seen', 'Última atividade'],
  ['reports', 'Mais queixas'],
  ['followers', 'Mais seguidores'],
  ['username', '@ (A a Z)'],
];
const COUNTRIES = ['AO', 'PT', 'BR', 'MZ', 'CV', 'GW', 'ST', 'TL', 'FR', 'GB', 'US', 'ZA', 'NA'];
const KEYS = ['status', 'verified', 'country', 'from', 'to', 'reports', 'minors', 'sort'] as const;

/** Contas: pesquisa, filtros, ordenação, páginas e exportação. Os filtros ficam no endereço (dá para partilhar a ligação). */
export default function BackofficeUsers() {
  const [params, setParams] = useSearchParams();
  const canExport = useCan('users.export');
  const [text, setText] = useState(params.get('q') ?? '');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const filters: AccountFilters = useMemo(() => ({
    q,
    status: params.get('status') ?? '',
    verified: params.get('verified') ?? '',
    country: params.get('country') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    reports: params.get('reports') === '1',
    minors: params.get('minors') === '1',
    sort: params.get('sort') ?? 'recent',
  }), [q, params]);
  const set = (k: (typeof KEYS)[number], v: string | boolean) => {
    const next = new URLSearchParams(params);
    if (v === true) next.set(k, '1');
    else if (typeof v === 'string' && v && !(k === 'sort' && v === 'recent')) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const active = KEYS.filter((k) => k !== 'sort' && params.get(k)).length;
  const clear = () => { setText(''); setParams({}, { replace: true }); };

  const list = useInfiniteQuery({
    queryKey: ['bo-accounts', filters],
    queryFn: ({ pageParam }) => contasApi.list(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  async function exportCsv() {
    setExporting(true);
    setExportErr('');
    try {
      await contasApi.exportCsv(filters);
    } catch (e) {
      setExportErr((e as Error).message);
    }
    setExporting(false);
  }

  return (
    <>
      <PageHeader
        title="Contas"
        description="Procura por @, nome ou email, filtra e abre a ficha: resumo, atividade, queixas, sessões, notas e histórico."
        actions={canExport && (
          <button type="button" onClick={() => void exportCsv()} disabled={exporting} className={btnGhost} title="Só campos não sensíveis (sem email, nome nem idade). Fica no registo.">
            <Icon name="download" size={16} /><span className="ml-1.5">{exporting ? 'A preparar…' : 'Exportar CSV'}</span>
          </button>
        )}
      />
      {exportErr && <p role="alert" className="-mt-3 mb-3 text-sm text-red-600">{exportErr}</p>}

      <section aria-label="Filtros" className="rounded-2xl bg-white p-3 ring-1 ring-zinc-200/70 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-64">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"><Icon name="search" size={16} /></span>
            <input value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="Procurar por @, nome ou email" aria-label="Procurar contas" className={`${inputCls} w-full pl-9`} />
          </label>
          <select value={filters.sort} onChange={(e) => set('sort', e.target.value)} aria-label="Ordenar" className={inputCls}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Estado" className={inputCls}>
            <option value="">Todos os estados</option>
            <option value="active">Ativas</option>
            <option value="suspended">Suspensas</option>
            <option value="deleted">Eliminadas</option>
          </select>
          <select value={filters.verified} onChange={(e) => set('verified', e.target.value)} aria-label="Verificação" className={inputCls}>
            <option value="">Verificação: todas</option>
            <option value="email">Email confirmado</option>
            <option value="unconfirmed">Email por confirmar</option>
            <option value="badge">Com selo</option>
          </select>
          <select value={filters.country} onChange={(e) => set('country', e.target.value)} aria-label="País" className={inputCls}>
            <option value="">Todos os países</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-zinc-600">
            Registo de
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set('from', e.target.value)} aria-label="Registo desde" className={`${inputCls} px-2`} />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-zinc-600">
            a
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} aria-label="Registo até" className={`${inputCls} px-2`} />
          </label>
          <FilterChip on={!!filters.reports} onClick={() => set('reports', !filters.reports)}>Com queixas</FilterChip>
          <FilterChip on={!!filters.minors} onClick={() => set('minors', !filters.minors)}>Menores</FilterChip>
          {(active > 0 || q) && <button type="button" onClick={clear} className="ml-auto text-sm font-semibold text-zinc-500 underline hover:text-zinc-900">Limpar filtros</button>}
        </div>
      </section>

      <div className="mt-4">
        {list.isLoading && <ContasLoading rows={6} label="A carregar contas" />}
        {list.isError && <ContasError error={list.error} onRetry={() => void list.refetch()} title="Não foi possível carregar as contas" />}
        {list.isSuccess && rows.length === 0 && <Empty title="Nenhuma conta encontrada" text={active || q ? 'Experimenta mudar ou limpar os filtros.' : undefined} />}
        {rows.length > 0 && (
          <>
            {/* Telemóvel: cartões. */}
            <ul className="space-y-2 md:hidden">
              {rows.map((u) => <li key={u.id}><AccountCard u={u} /></li>)}
            </ul>
            {/* Computador: tabela. */}
            <div className="hidden md:block">
              <ContasTable minWidth={900}>
                <thead className="border-b border-zinc-200 bg-zinc-50">
                  <tr>
                    <th className={th}>Conta</th>
                    <th className={th}>Estado</th>
                    <th className={th}>País</th>
                    <th className={`${th} text-right`}>Publ.</th>
                    <th className={`${th} text-right`}>Seguidores</th>
                    <th className={`${th} text-right`}>Queixas</th>
                    <th className={th}>Última atividade</th>
                    <th className={th}>Registo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.map((u) => (
                    <tr key={u.id} className="hover:bg-zinc-50">
                      <td className={td}>
                        <Link to={`/backoffice/users/${u.id}`} className="font-semibold underline-offset-2 hover:underline">@{u.username}</Link>
                        <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">{u.minor && <MinorBadge />}<BadgeTier tier={u.badge} />{u.is_admin && <Badge tone="blue">moderação</Badge>}</span>
                        <span className="block max-w-[280px] truncate text-xs text-zinc-500">{u.display_name} · {u.email}</span>
                      </td>
                      <td className={td}>
                        <span className="flex flex-col items-start gap-1">{statusBadge(u.status)}{!u.verified && <Badge tone="amber">email por confirmar</Badge>}</span>
                      </td>
                      <td className={td}>{countryName(u.country)}</td>
                      <td className={`${td} text-right tabular-nums`}>{u.posts}</td>
                      <td className={`${td} text-right tabular-nums`}>{u.followers.toLocaleString('pt-PT')}</td>
                      <td className={`${td} text-right tabular-nums`}>{u.reports > 0 ? <Badge tone={u.reports_open > 0 ? 'red' : 'zinc'}>{u.reports}{u.reports_open > 0 ? ` · ${u.reports_open} por decidir` : ''}</Badge> : <span className="text-zinc-400">0</span>}</td>
                      <td className={td}>{ago(u.last_seen)}</td>
                      <td className={td}>{new Date(u.created_at).toLocaleDateString('pt-PT')}</td>
                    </tr>
                  ))}
                </tbody>
              </ContasTable>
            </div>
          </>
        )}
        {list.hasNextPage && (
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className={btnGhost}>{list.isFetchingNextPage ? 'A carregar…' : 'Mostrar mais'}</button>
          </div>
        )}
        {list.isSuccess && rows.length > 0 && !list.hasNextPage && <p className="mt-4 text-center text-xs text-zinc-400">{rows.length} {rows.length === 1 ? 'conta' : 'contas'} · fim da lista</p>}
      </div>
    </>
  );
}

function AccountCard({ u }: { u: AccountRow }) {
  return (
    <Link to={`/backoffice/users/${u.id}`} className="block rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70 active:bg-zinc-50">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold">@{u.username}</p>
          <p className="truncate text-xs text-zinc-500">{u.display_name} · {u.email}</p>
        </div>
        {statusBadge(u.status)}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {u.minor && <MinorBadge />}
        <BadgeTier tier={u.badge} />
        {!u.verified && <Badge tone="amber">email por confirmar</Badge>}
        {u.reports > 0 && <Badge tone={u.reports_open > 0 ? 'red' : 'zinc'}>{u.reports} {u.reports === 1 ? 'queixa' : 'queixas'}</Badge>}
      </div>
      <p className="mt-2 text-xs text-zinc-500">{countryName(u.country)} · {u.posts} publ. · {u.followers} seguidores · ativa {ago(u.last_seen)}</p>
    </Link>
  );
}
