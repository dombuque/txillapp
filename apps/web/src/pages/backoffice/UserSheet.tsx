import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { api } from '../../lib/api';
import { Badge, Card, ReasonDialog, ago, btnDanger, btnGhost, btnPrimary, statusBadge, useCan, when } from './bo';
import { appUrl, contasApi, countryName, type AccountSession, type AccountSheet } from './ui/contas-api';
import { BadgeTier, ContasError, ContasFacts, ContasLoading, ContasNone, ContasStat, ContasTabs, DeviceGlyph, MinorBadge, SessionStateBadge } from './ui/contas-ui';

const ACTION: Record<string, string> = {
  'backoffice.verify_email': 'Confirmou o email',
  'backoffice.suspend': 'Suspendeu a conta',
  'backoffice.reactivate': 'Reativou a conta',
  'backoffice.note': 'Deixou uma nota',
  'backoffice.sessions_view': 'Viu as sessões',
  'backoffice.session_revoke': 'Terminou uma sessão',
  'backoffice.sessions_revoke_all': 'Terminou todas as sessões',
  'moderation.remove': 'Removeu conteúdo',
  'moderation.suspend': 'Suspendeu (queixa)',
  'moderation.dismiss': 'Ignorou uma queixa',
  'verification.approve': 'Aprovou o selo',
  'verification.reject': 'Recusou o selo',
  'staff.set_teams': 'Mudou as equipas',
  'staff.remove': 'Tirou o acesso à equipa',
  'account.deleted': 'Eliminou a conta',
  'auth.register': 'Registo',
};
const REASON: Record<string, string> = { spam: 'Spam', harassment: 'Assédio', hate: 'Ódio', nudity: 'Nudez', violence: 'Violência', scam: 'Burla', impersonation: 'Falsa identidade', minor: 'Menor', other: 'Outro' };
const TYPE: Record<string, string> = { post: 'publicação', comment: 'comentário', story: 'mimo', user: 'perfil', message: 'mensagem', media: 'foto' };
const reportStatus = (s: string) => <Badge tone={s === 'open' ? 'amber' : s === 'actioned' ? 'red' : 'zinc'}>{s === 'open' ? 'por decidir' : s === 'actioned' ? 'com ação' : 'ignorada'}</Badge>;

type Tab = 'resumo' | 'atividade' | 'queixas' | 'sessoes' | 'notas' | 'historico';

/** A ficha de uma conta, por separadores: resumo, atividade, queixas, sessões, notas e histórico da equipa. */
export default function BackofficeUser() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const canVerify = useCan('users.verify_email');
  const canSuspend = useCan('users.suspend');
  const canSessions = useCan('users.sessions');
  const q = useQuery({ queryKey: ['bo-user', id], queryFn: () => contasApi.sheet(id), retry: false });
  const [dialog, setDialog] = useState<null | 'verify' | 'suspend' | 'reactivate'>(null);
  const tabParam = (params.get('tab') ?? 'resumo') as Tab;
  const tab: Tab = tabParam === 'sessoes' && !canSessions ? 'resumo' : tabParam;
  const setTab = (t: Tab) => setParams(t === 'resumo' ? {} : { tab: t }, { replace: true });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['bo-user', id] });
    void qc.invalidateQueries({ queryKey: ['bo-accounts'] });
    void qc.invalidateQueries({ queryKey: ['bo-overview'] });
  };

  const back = <Link to="/backoffice/users" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900"><Icon name="chevron-left" size={16} /> Contas</Link>;
  if (q.isLoading) return <>{back}<div className="mt-4"><ContasLoading rows={5} label="A carregar a conta" /></div></>;
  if (q.isError || !q.data) return <>{back}<div className="mt-4"><ContasError error={q.error} onRetry={() => void q.refetch()} title="Não foi possível abrir a conta" /></div></>;
  const s = q.data;
  const u = s.user;

  const tabs: { id: Tab; label: string; count?: number; tone?: 'red' | 'amber' }[] = [
    { id: 'resumo', label: 'Resumo' },
    { id: 'atividade', label: 'Atividade' },
    { id: 'queixas', label: 'Queixas', count: s.reportCounts.against_open || s.reportCounts.against, tone: s.reportCounts.against_open ? 'red' : undefined },
    ...(canSessions ? [{ id: 'sessoes' as Tab, label: 'Sessões e aparelhos', count: u.sessions }] : []),
    { id: 'notas', label: 'Notas', count: s.notes.length, tone: 'amber' as const },
    { id: 'historico', label: 'Histórico' },
  ];

  return (
    <>
      {back}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xl font-extrabold text-white" aria-hidden>{u.username[0]?.toUpperCase()}</span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold tracking-tight">@{u.username}</h1>
            <p className="truncate text-zinc-600">{u.display_name}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {statusBadge(u.status)}
              {u.minor && <MinorBadge />}
              <BadgeTier tier={u.badge} />
              {u.is_admin && <Badge tone="blue">moderação</Badge>}
              {u.email_verified_at ? <Badge tone="green">email confirmado</Badge> : <Badge tone="amber">email por confirmar</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canVerify && !u.email_verified_at && u.status !== 'deleted' && <button type="button" onClick={() => setDialog('verify')} className={btnPrimary}>Confirmar email à mão</button>}
          {canSuspend && u.status === 'active' && !u.is_admin && <button type="button" onClick={() => setDialog('suspend')} className={btnDanger}>Suspender</button>}
          {canSuspend && u.status === 'suspended' && <button type="button" onClick={() => setDialog('reactivate')} className={btnPrimary}>Reativar</button>}
          {u.status !== 'deleted' && <a href={appUrl(`/u/${u.username}`)} target="_blank" rel="noreferrer" className={btnGhost}>Ver o perfil na app</a>}
        </div>
      </header>
      {u.minor && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Icon name="shield" size={18} />
          <span><b>Menor de 18 anos.</b> Não vê bebidas alcoólicas nem publicidade, e não aparece no mapa. Cuidado redobrado com o que se partilha sobre esta conta.</span>
        </p>
      )}

      <div className="mt-6">
        <ContasTabs tabs={tabs} value={tab} onChange={setTab} />
      </div>
      <div className="mt-5">
        {tab === 'resumo' && <Summary s={s} />}
        {tab === 'atividade' && <Activity s={s} />}
        {tab === 'queixas' && <Reports s={s} />}
        {tab === 'sessoes' && canSessions && <Sessions id={id} username={u.username} onChanged={refresh} />}
        {tab === 'notas' && <Notes id={id} notes={s.notes} onChanged={refresh} />}
        {tab === 'historico' && <History history={s.history} />}
      </div>

      {dialog === 'verify' && <ReasonDialog title="Confirmar o email à mão" help={`Marca o email ${u.email} como confirmado sem a pessoa clicar na ligação. Usa só se tiveres a certeza de quem é.`} confirm="Confirmar email" onCancel={() => setDialog(null)} onConfirm={async (reason) => { await api.boVerifyEmail(id, reason); setDialog(null); await refresh(); }} />}
      {dialog === 'suspend' && <ReasonDialog title={`Suspender @${u.username}`} help="Perde as sessões e não volta a entrar até ser reativada." confirm="Suspender" danger onCancel={() => setDialog(null)} onConfirm={async (reason) => { await api.boSuspend(id, reason); setDialog(null); await refresh(); }} />}
      {dialog === 'reactivate' && <ReasonDialog title={`Reativar @${u.username}`} confirm="Reativar" onCancel={() => setDialog(null)} onConfirm={async (reason) => { await api.boReactivate(id, reason); setDialog(null); await refresh(); }} />}
    </>
  );
}

function Summary({ s }: { s: AccountSheet }) {
  const u = s.user;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ContasStat label="Estado" value={u.status === 'active' ? 'Ativa' : u.status === 'suspended' ? 'Suspensa' : 'Eliminada'} tone={u.status === 'active' ? 'green' : u.status === 'suspended' ? 'red' : undefined} />
        <ContasStat label="Idade" value={u.age ?? '—'} hint={u.minor ? 'menor de 18' : u.age === null ? 'sem data de nascimento' : undefined} tone={u.minor ? 'amber' : undefined} />
        <ContasStat label="País" value={<span className="text-lg">{countryName(u.country)}</span>} hint={u.city ?? undefined} />
        <ContasStat label="Última atividade" value={<span className="text-lg">{ago(u.last_active)}</span>} hint={`${u.sessions} ${u.sessions === 1 ? 'sessão ativa' : 'sessões ativas'}`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Dados">
          <ContasFacts rows={[
            ['Email', <span key="e" className="break-all">{u.email}</span>],
            ['Email confirmado', u.email_verified_at ? when(u.email_verified_at) : 'por confirmar'],
            ['Selo', u.badge === 'official' ? 'conta oficial' : u.badge === 'verified' ? 'verificada' : 'sem selo'],
            ['Perfil', u.is_private ? 'privado' : 'público'],
            ['Conta criada', when(u.created_at)],
            ['Termos aceites', u.terms_version ? `${u.terms_version}${u.terms_accepted_at ? ` · ${new Date(u.terms_accepted_at).toLocaleDateString('pt-PT')}` : ''}` : '—'],
            ['Último login', ago(u.last_seen)],
          ]} />
        </Card>
        <Card title="Txills e convites">
          <ContasFacts rows={[
            ['Saldo de Txills', Number(u.txills).toLocaleString('pt-PT')],
            ['Convidou', s.invite.invited],
            ['Convites com prémio', s.invite.paid],
            ['Veio por convite de', s.invite.came_from ? <span key="c">@{s.invite.came_from.inviter} <Badge tone={s.invite.came_from.status === 'blocked' ? 'red' : 'zinc'}>{s.invite.came_from.status}{s.invite.came_from.reason ? `: ${s.invite.came_from.reason}` : ''}</Badge></span> : '—'],
          ]} />
        </Card>
      </div>
    </div>
  );
}

function Activity({ s }: { s: AccountSheet }) {
  const u = s.user;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <ContasStat label="Publicações" value={u.posts} hint={u.posts_removed ? `${u.posts_removed} removidas` : undefined} tone={u.posts_removed ? 'red' : undefined} />
        <ContasStat label="Mimos" value={u.stories} />
        <ContasStat label="Comentários" value={u.comments} />
        <ContasStat label="Seguidores" value={u.followers.toLocaleString('pt-PT')} />
        <ContasStat label="A seguir" value={u.following.toLocaleString('pt-PT')} />
        <ContasStat label="Mensagens" value={u.messages.toLocaleString('pt-PT')} hint="enviadas" />
      </div>
      <Card title="Últimas publicações" right={<span className="text-xs text-zinc-500">Última atividade {ago(u.last_active)}</span>}>
        {s.recentPosts.length === 0 ? <ContasNone>Ainda não publicou nada.</ContasNone> : (
          <ul className="divide-y divide-zinc-100">
            {s.recentPosts.map((p) => (
              <li key={p.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500" aria-hidden><Icon name={p.media ? 'image' : 'file-text'} size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className={`line-clamp-2 break-words text-sm ${p.removed_at ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>{p.body || <i className="text-zinc-400">{p.media ? `${p.media} ${p.media === 1 ? 'foto ou vídeo' : 'fotos ou vídeos'}, sem texto` : 'sem texto'}</i>}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                    {when(p.created_at)}
                    {p.kind === 'gift' && <Badge>brinde</Badge>}
                    {p.removed_at && <Badge tone="red">{p.removed_by === 'moderation' ? 'removida pela moderação' : 'apagada pela pessoa'}</Badge>}
                  </p>
                </div>
                {!p.removed_at && <a href={appUrl(`/p/${p.id}`)} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-semibold text-zinc-600 underline hover:text-zinc-900">Abrir</a>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Reports({ s }: { s: AccountSheet }) {
  const c = s.reportCounts;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <ContasStat label="Recebidas" value={c.against} tone={c.against ? 'red' : undefined} />
        <ContasStat label="Por decidir" value={c.against_open} tone={c.against_open ? 'amber' : undefined} />
        <ContasStat label="Feitas" value={c.made} />
      </div>
      <Card title="Queixas contra esta conta" right={c.against_open > 0 ? <Link to="/backoffice/reports" className="text-sm font-semibold underline">Abrir as queixas</Link> : undefined}>
        {s.reportsAgainst.length === 0 ? <ContasNone>Nenhuma queixa contra esta conta.</ContasNone> : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {s.reportsAgainst.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="font-semibold">{REASON[r.reason] ?? r.reason}</span>
                <Badge>{TYPE[r.target_type] ?? r.target_type}</Badge>
                {reportStatus(r.status)}
                {r.resolution_note && <span className="text-zinc-600">— {r.resolution_note}</span>}
                <span className="ml-auto text-xs text-zinc-500">{r.reporter ? `por @${r.reporter} · ` : 'automática · '}{when(r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Queixas feitas por esta conta">
        {s.reportsMade.length === 0 ? <ContasNone>Não fez queixas.</ContasNone> : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {s.reportsMade.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="font-semibold">{REASON[r.reason] ?? r.reason}</span>
                <Badge>{TYPE[r.target_type] ?? r.target_type}</Badge>
                {reportStatus(r.status)}
                <span className="ml-auto text-xs text-zinc-500">{r.target_owner ? `contra @${r.target_owner} · ` : ''}{when(r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Sessions({ id, username, onChanged }: { id: string; username: string; onChanged: () => Promise<void> }) {
  const qc = useQueryClient();
  // Cada abertura fica na auditoria: não se volta a pedir sozinho.
  const q = useQuery({ queryKey: ['bo-user-sessions', id], queryFn: () => contasApi.sessions(id), retry: false, staleTime: Infinity, refetchOnWindowFocus: false });
  const [revoke, setRevoke] = useState<AccountSession | 'all' | null>(null);
  const [done, setDone] = useState('');
  const after = async (msg: string) => {
    setRevoke(null);
    setDone(msg);
    await qc.invalidateQueries({ queryKey: ['bo-user-sessions', id] });
    await onChanged();
  };
  if (q.isLoading) return <ContasLoading rows={3} label="A carregar as sessões" />;
  if (q.isError || !q.data) return <ContasError error={q.error} onRetry={() => void q.refetch()} title="Não foi possível carregar as sessões" />;
  const active = q.data.sessions.filter((x) => x.state === 'active');

  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 text-sm text-zinc-500">
        <Icon name="eye" size={16} />
        <span>Ver esta lista e terminar sessões fica no registo. Uma linha por login. As sessões não guardam o endereço IP.</span>
      </p>
      {done && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-900">{done}</p>}
      <Card title={`Sessões (${active.length} ${active.length === 1 ? 'ativa' : 'ativas'})`} right={active.length > 0 && <button type="button" onClick={() => setRevoke('all')} className={`${btnDanger} h-8 px-3`}>Terminar todas</button>}>
        {q.data.sessions.length === 0 ? <ContasNone>Nunca entrou.</ContasNone> : (
          <ul className="divide-y divide-zinc-100">
            {q.data.sessions.map((x) => (
              <li key={x.id} className={`flex flex-wrap items-center gap-3 py-3 ${x.state === 'active' ? '' : 'opacity-70'}`}>
                <DeviceGlyph mobile={x.mobile} kind={x.kind} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-zinc-900">{x.device} <SessionStateBadge state={x.state} /></p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Entrou {when(x.loginAt)} · última atividade {ago(x.lastActiveAt)}
                    {x.state === 'active' && ` · expira ${new Date(x.expiresAt).toLocaleDateString('pt-PT')}`}
                    {x.state === 'ended' && x.endedAt && ` · terminou ${when(x.endedAt)}`}
                    {x.state === 'expired' && ` · expirou ${new Date(x.expiresAt).toLocaleDateString('pt-PT')}`}
                  </p>
                </div>
                {x.state === 'active' && <button type="button" onClick={() => setRevoke(x)} className={`${btnGhost} h-8 px-3`}>Terminar sessão</button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Notificações">
        {q.data.devices.length === 0 && q.data.webPush === 0 ? <ContasNone>Nenhum aparelho recebe notificações desta conta.</ContasNone> : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {q.data.devices.map((d, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5">
                <DeviceGlyph mobile />
                <span className="flex-1 font-semibold">{d.platform === 'ios' ? 'iPhone' : 'Android'} · app Txillapp</span>
                <span className="text-xs text-zinc-500">ligado {when(d.createdAt)} · atualizado {ago(d.updatedAt)}</span>
              </li>
            ))}
            {q.data.webPush > 0 && (
              <li className="flex items-center gap-3 py-2.5">
                <DeviceGlyph mobile={false} />
                <span className="flex-1 font-semibold">{q.data.webPush} {q.data.webPush === 1 ? 'browser' : 'browsers'} com notificações</span>
              </li>
            )}
          </ul>
        )}
      </Card>

      {revoke && revoke !== 'all' && (
        <ReasonDialog
          title="Terminar esta sessão"
          help={`${revoke.device}: deixa de conseguir renovar a sessão e sai dentro de poucos minutos. @${username} pode voltar a entrar com a senha.`}
          confirm="Terminar sessão"
          danger
          onCancel={() => setRevoke(null)}
          onConfirm={async (reason) => { await contasApi.revokeSession(id, revoke.id, reason); await after(`Sessão terminada: ${revoke.device}.`); }}
        />
      )}
      {revoke === 'all' && (
        <ReasonDialog
          title={`Terminar todas as sessões de @${username}`}
          help="Sai de todos os aparelhos dentro de poucos minutos, e os telemóveis deixam de receber notificações até voltar a entrar. Usa quando a conta pode estar nas mãos de outra pessoa."
          confirm="Terminar todas"
          danger
          onCancel={() => setRevoke(null)}
          onConfirm={async (reason) => { const r = await contasApi.revokeAll(id, reason); await after(r.sessions === 1 ? '1 sessão terminada.' : `${r.sessions} sessões terminadas.`); }}
        />
      )}
    </div>
  );
}

function Notes({ id, notes, onChanged }: { id: string; notes: AccountSheet['notes']; onChanged: () => Promise<void> }) {
  const canNote = useCan('users.notes');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function add() {
    if (!note.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await api.boNote(id, note.trim());
      setNote('');
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <Card title="Notas da equipa" right={<span className="text-xs text-zinc-500">Só a equipa vê</span>}>
      {canNote && (
        <div className="mb-4">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void add(); }} rows={3} maxLength={1000} placeholder="Escreve uma nota: o que aconteceu, o que combinaste com a pessoa…" aria-label="Nova nota" className="w-full rounded-lg border border-zinc-300 p-2.5 text-sm outline-none focus:border-zinc-900" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-400">{note.length}/1000</span>
            <button type="button" disabled={busy || !note.trim()} onClick={() => void add()} className={btnPrimary}>{busy ? 'A guardar…' : 'Guardar nota'}</button>
          </div>
          {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        </div>
      )}
      {notes.length === 0 ? <ContasNone>Sem notas.</ContasNone> : (
        <ul className="space-y-2 text-sm">
          {notes.map((n) => <li key={n.id} className="rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-100"><p className="whitespace-pre-wrap break-words">{n.body}</p><p className="mt-1 text-xs text-zinc-500">{n.author_name ?? (n.author ? `@${n.author}` : '—')} · {when(n.created_at)}</p></li>)}
        </ul>
      )}
    </Card>
  );
}

function History({ history }: { history: AccountSheet['history'] }) {
  const [staffOnly, setStaffOnly] = useState(true);
  const rows = staffOnly ? history.filter((h) => h.by_staff) : history;
  const reason = (m: Record<string, unknown>): ReactNode => {
    const r = typeof m?.reason === 'string' ? m.reason : typeof m?.motivo === 'string' ? m.motivo : null;
    const device = typeof m?.device === 'string' ? m.device : null;
    return <>{device && <span className="text-zinc-600"> · {device}</span>}{r && <span className="text-zinc-600"> — {r}</span>}</>;
  };
  return (
    <Card title="Histórico" right={
      <label className="flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} className="h-4 w-4 accent-zinc-900" /> Só ações da equipa</label>
    }>
      {rows.length === 0 ? <ContasNone>Sem registos.</ContasNone> : (
        <ol className="relative ml-2 border-l border-zinc-200">
          {rows.map((h, i) => (
            <li key={i} className="relative py-2 pl-5 text-sm">
              <span className={`absolute -left-[5px] top-3.5 h-2.5 w-2.5 rounded-full ${h.by_staff ? 'bg-zinc-900' : 'bg-zinc-300'}`} aria-hidden />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="min-w-0">
                  <span className="font-semibold">{ACTION[h.action] ?? h.action}</span>
                  <span className="text-zinc-600">{h.by_staff ? (h.actor_name ? ` · por ${h.actor_name}` : h.actor ? ` · por @${h.actor}` : '') : ' · pela própria pessoa'}</span>
                  {reason(h.metadata)}
                </p>
                <span className="text-xs text-zinc-500">{when(h.created_at)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
