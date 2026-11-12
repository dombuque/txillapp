import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LoadingBlock } from '../../components/Loading';
import { Badge, Card, Empty, PageHeader, ReasonDialog, ago, btnDanger, btnGhost, btnPrimary, useCan, when } from './bo';
import { MusicCatalogPanel } from './MusicCatalog';
import {
  LINK_LABEL, RELATION_LABEL, mmss, musicApi, safeHref,
  type ArtistRequest, type ArtistStatus, type ArtistTrackItem, type ClaimStatus, type RightsClaim, type TrackStatus,
} from './ui/music-api';

type Tab = 'catalog' | 'artists' | 'tracks' | 'claims';

/** Pede o motivo (fica no registo) e decide. */
type Ask = { title: string; help?: string; confirm: string; danger?: boolean; run: (reason: string) => Promise<void> };

function Filter<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2" role="tablist">
      {options.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}
          className={`h-8 rounded-full px-3.5 text-sm font-semibold transition ${value === id ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function List<T>({ q, empty, render }: { q: { isLoading: boolean; isError: boolean; data?: T[] }; empty: string; render: (x: T) => ReactNode }) {
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <p role="alert" className="text-center text-red-600">Não foi possível carregar.</p>;
  if (!q.data?.length) return <Empty title={empty} />;
  return <ul className="grid gap-4 xl:grid-cols-2">{q.data.map(render)}</ul>;
}

const Meta = ({ label, children }: { label: string; children: ReactNode }) => (
  <p className="text-sm text-zinc-600"><span className="font-semibold text-zinc-800">{label}:</span> {children}</p>
);

const trackTone = (s: string) => (s === 'approved' ? 'green' : s === 'pending' ? 'amber' : s === 'removed' || s === 'rejected' ? 'red' : 'zinc') as 'green' | 'amber' | 'red' | 'zinc';
const TRACK_STATUS: Record<string, string> = { pending: 'Por moderar', approved: 'Aprovada', rejected: 'Recusada', withdrawn: 'Retirada pelo artista', removed: 'Tirada pela equipa' };
const ARTIST_STATUS: Record<string, string> = { pending: 'Por decidir', approved: 'Artista', rejected: 'Recusado', revoked: 'Estatuto tirado', withdrawn: 'Retirado' };

function ArtistCard({ a, can, ask, done }: { a: ArtistRequest; can: boolean; ask: (x: Ask) => void; done: () => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function approve() {
    setBusy(true);
    setErr('');
    try {
      await musicApi.decideArtist(a.userId, 'approve');
      done();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  // URL privado e temporário do servidor (/api/v1/chat/media/…?sig=…).
  const proof = a.proofUrl?.startsWith('/api/') ? a.proofUrl : null;
  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-lg font-bold text-zinc-900">{a.stageName}</p>
            <Link to={`/backoffice/users/${a.userId}`} className="text-sm font-semibold text-brand">@{a.user.username}</Link>
            <span className="text-sm text-zinc-500"> · {a.user.displayName} · {a.user.followers} seguidores · {a.tracks} faixas</span>
          </div>
          <Badge tone={a.status === 'approved' ? 'green' : a.status === 'pending' ? 'amber' : 'red'}>{ARTIST_STATUS[a.status] ?? a.status}</Badge>
        </div>
        <div className="mt-3 space-y-1">
          <Meta label="Estilos">{a.styles.join(', ') || '—'}</Meta>
          <Meta label="Direitos">{a.rightsKind === 'label' ? `Editora: ${a.labelName ?? '—'}` : 'Declaração do artista'}</Meta>
          <Meta label="Pedido">{ago(a.updatedAt)}</Meta>
          {a.reason && <Meta label="Motivo">{a.reason}</Meta>}
        </div>
        <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-zinc-50 p-3 text-sm text-zinc-800">{a.rightsStatement}</p>
        {a.links.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {a.links.map((l) => {
              const href = safeHref(l.url);
              return (
                <li key={`${l.kind}-${l.url}`}>
                  {href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-full bg-zinc-100 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-200">{LINK_LABEL[l.kind] ?? l.kind} ↗</a> : <span className="text-sm text-zinc-500">{l.url}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {proof && (
          <a href={proof} target="_blank" rel="noreferrer" className="mt-3 block">
            <img src={proof} alt="Prova dos direitos" className="max-h-56 rounded-xl object-contain ring-1 ring-zinc-200" />
            <span className="mt-1 block text-xs text-zinc-500">Prova dos direitos (privada; apaga-se depois de decidir)</span>
          </a>
        )}
        {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        {can && (a.status === 'pending' || a.status === 'approved') && (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {a.status === 'pending' ? (
              <>
                <button type="button" className={btnGhost} disabled={busy}
                  onClick={() => ask({ title: `Recusar o pedido de ${a.stageName}`, help: 'A pessoa vai ver o motivo e pode pedir outra vez.', confirm: 'Recusar', danger: true, run: (r) => musicApi.decideArtist(a.userId, 'reject', r) })}>Recusar</button>
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => void approve()}>Aprovar</button>
              </>
            ) : (
              <button type="button" className={btnDanger}
                onClick={() => ask({ title: `Tirar o estatuto de artista a ${a.stageName}`, help: 'A etiqueta «Artista» sai do perfil e as faixas deixam de estar disponíveis para novos usos.', confirm: 'Tirar o estatuto', danger: true, run: (r) => musicApi.decideArtist(a.userId, 'revoke', r) })}>Tirar o estatuto</button>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

function TrackCard({ t, can, ask, done }: { t: ArtistTrackItem; can: boolean; ask: (x: Ask) => void; done: () => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(action: 'approve' | 'restore') {
    setBusy(true);
    setErr('');
    try {
      await musicApi.decideTrack(t.id, action);
      done();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <li>
      <Card>
        <div className="flex gap-4">
          {t.cover ? <img src={t.cover} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" /> : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-2xl text-zinc-400" aria-hidden>♪</div>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-lg font-bold text-zinc-900">{t.title}</p>
              <Badge tone={trackTone(t.status)}>{TRACK_STATUS[t.status] ?? t.status}</Badge>
              {t.explicit && <Badge tone="zinc">Explícita</Badge>}
              {t.onHold && <Badge tone="red">Escondida por denúncia</Badge>}
            </div>
            <p className="text-sm text-zinc-600">
              {t.artist.stageName} · <Link to={`/backoffice/users/${t.artist.userId}`} className="font-semibold text-brand">@{t.artist.username}</Link>
              {' · '}{t.artist.rightsKind === 'label' ? `Editora: ${t.artist.labelName ?? '—'}` : 'Declaração do artista'}
            </p>
            <p className="text-sm text-zinc-500">{t.styles.join(', ')} · {mmss(t.durationMs)} no total · trecho {mmss(t.previewStartMs)}–{mmss(t.previewStartMs + t.previewMs)}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2">
          {t.previewUrl && (
            <label className="text-xs font-semibold text-zinc-500">Trecho (o que se ouve no Txillapp)
              <audio controls preload="none" src={t.previewUrl} className="mt-1 w-full" />
            </label>
          )}
          {t.originalUrl && (
            <label className="text-xs font-semibold text-zinc-500">Original (só a equipa)
              <audio controls preload="none" src={t.originalUrl} className="mt-1 w-full" />
            </label>
          )}
        </div>
        <div className="mt-3 space-y-1">
          <Meta label="Licença">{t.license ? <>versão {t.license.version} · aceite {when(t.license.acceptedAt)} · <span className="font-mono text-xs" title={t.license.sha256}>{t.license.sha256.slice(0, 12)}…</span></> : '—'}</Meta>
          <Meta label="Usos">{t.uses} {t.uses === 1 ? 'vez' : 'vezes'}, por {t.people} {t.people === 1 ? 'pessoa' : 'pessoas'}</Meta>
          {t.openClaims > 0 && <Meta label="Denúncias abertas">{t.openClaims} (ver «Direitos de autor»)</Meta>}
          <Meta label="Carregada">{ago(t.createdAt)}</Meta>
          {t.reason && <Meta label="Motivo">{t.reason}</Meta>}
        </div>
        {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        {can && (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {t.status === 'pending' && (
              <>
                <button type="button" className={btnGhost} disabled={busy}
                  onClick={() => ask({ title: `Recusar «${t.title}»`, help: 'O artista vai ver o motivo.', confirm: 'Recusar', danger: true, run: (r) => musicApi.decideTrack(t.id, 'reject', r) })}>Recusar</button>
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => void act('approve')}>Aprovar</button>
              </>
            )}
            {(t.status === 'approved' || t.status === 'withdrawn') && (
              <button type="button" className={btnDanger} disabled={busy}
                onClick={() => ask({ title: `Tirar «${t.title}»`, help: 'Sai do seletor e deixa de tocar em todo o lado, também nos mimos e tchekas que já a usam.', confirm: 'Tirar', danger: true, run: (r) => musicApi.decideTrack(t.id, 'remove', r) })}>Tirar</button>
            )}
            {t.status === 'removed' && <button type="button" className={btnGhost} disabled={busy} onClick={() => window.confirm(`Repor «${t.title}»? Volta a aparecer no seletor.`) && void act('restore')}>Repor</button>}
          </div>
        )}
      </Card>
    </li>
  );
}

function ClaimCard({ c, can, ask }: { c: RightsClaim; can: boolean; ask: (x: Ask) => void }) {
  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-lg font-bold text-zinc-900">{c.track.title}</p>
            <p className="text-sm text-zinc-600">{c.track.artist} · @{c.track.artistUsername} · {TRACK_STATUS[c.track.status] ?? c.track.status}</p>
          </div>
          <Badge tone={c.status === 'open' ? 'amber' : c.status === 'upheld' ? 'red' : 'zinc'}>{c.status === 'open' ? 'Por decidir' : c.status === 'upheld' ? 'Com razão' : 'Sem razão'}</Badge>
        </div>
        {c.track.previewUrl && <audio controls preload="none" src={c.track.previewUrl} className="mt-3 w-full" />}
        <div className="mt-3 space-y-1">
          <Meta label="Quem reclama">{c.claimantName} ({RELATION_LABEL[c.relation] ?? c.relation})</Meta>
          <Meta label="Contacto"><a href={`mailto:${c.contactEmail}`} className="font-semibold text-brand">{c.contactEmail}</a></Meta>
          <Meta label="Denunciada por">{c.reporter ? `@${c.reporter}` : 'conta eliminada'} · {ago(c.createdAt)}</Meta>
          {c.decisionNote && <Meta label="Decisão">{c.decisionNote}</Meta>}
        </div>
        <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-zinc-50 p-3 text-sm text-zinc-800">{c.details}</p>
        {can && c.status === 'open' && (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" className={btnGhost}
              onClick={() => ask({ title: 'Não dar razão à denúncia', help: 'Se não houver outras denúncias abertas, a faixa volta a aparecer e a tocar.', confirm: 'Não dar razão', run: (r) => musicApi.decideClaim(c.id, 'dismiss', r) })}>Não dar razão</button>
            <button type="button" className={btnDanger}
              onClick={() => ask({ title: 'Dar razão à denúncia', help: 'A faixa sai de vez: do seletor e dos mimos e tchekas que já a usam. O artista é avisado com o motivo.', confirm: 'Dar razão', danger: true, run: (r) => musicApi.decideClaim(c.id, 'uphold', r) })}>Dar razão</button>
          </div>
        )}
      </Card>
    </li>
  );
}

/**
 * Backoffice › Música, numa só entrada com separadores: Catálogo (o catálogo curado do seletor, catalog.manage) e o programa de
 * artistas moçambicanos (music.manage): pedidos de artista, moderação das faixas e denúncias de direitos de autor.
 */
export default function BackofficeMusic() {
  const qc = useQueryClient();
  const can = useCan('music.manage');
  const canCatalog = useCan('catalog.manage');
  // ?tab=artists|tracks|claims|catalog (o cartão «Música por decidir» do início abre logo os pedidos).
  const [params] = useSearchParams();
  const asked = params.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(asked === 'catalog' ? (canCatalog ? 'catalog' : 'artists') : asked && ['artists', 'tracks', 'claims'].includes(asked) && can ? asked : canCatalog ? 'catalog' : 'artists');
  const [aStatus, setAStatus] = useState<ArtistStatus>('pending');
  const [tStatus, setTStatus] = useState<TrackStatus>('pending');
  const [cStatus, setCStatus] = useState<ClaimStatus>('open');
  const [asking, setAsking] = useState<Ask | null>(null);
  const summary = useQuery({ queryKey: ['bo-music', 'summary'], queryFn: musicApi.summary, enabled: can, refetchInterval: 60_000 });
  const artists = useQuery({ queryKey: ['bo-music', 'artists', aStatus], queryFn: () => musicApi.artists(aStatus), enabled: can && tab === 'artists' });
  const tracks = useQuery({ queryKey: ['bo-music', 'tracks', tStatus], queryFn: () => musicApi.tracks(tStatus), enabled: can && tab === 'tracks' });
  const claims = useQuery({ queryKey: ['bo-music', 'claims', cStatus], queryFn: () => musicApi.claims(cStatus), enabled: can && tab === 'claims' });
  const done = () => void qc.invalidateQueries({ queryKey: ['bo-music'] });
  const s = summary.data;
  const count = (n?: number) => (n ? ` (${n})` : '');

  return (
    <>
      <PageHeader
        title="Música"
        description="O que toca nos mimos e nas tchekas. No Catálogo, o catálogo curado do seletor: esconder, destacar e ver as mais usadas e as mais rejeitadas. Nos outros separadores, o programa de artistas de Moçambique: aprova os pedidos de artista, modera as faixas antes de aparecerem e decide as denúncias de direitos de autor (uma faixa denunciada fica escondida até decidires). Todas as decisões ficam na auditoria."
      />
      <Filter<Tab>
        value={tab}
        onChange={setTab}
        options={[
          ...(canCatalog ? [['catalog', 'Catálogo'] as const] : []),
          ...(can ? ([['artists', `Pedidos de artista${count(s?.artists)}`], ['tracks', `Faixas${count(s?.tracks)}`], ['claims', `Direitos de autor${count(s?.claims)}`]] as const) : []),
        ]}
      />
      <div className="border-t border-zinc-200 pt-4">
        {tab === 'catalog' && canCatalog && <MusicCatalogPanel />}
        {tab === 'artists' && (
          <>
            <Filter<ArtistStatus> value={aStatus} onChange={setAStatus} options={[['pending', 'Por decidir'], ['approved', 'Aprovados'], ['rejected', 'Recusados'], ['revoked', 'Estatuto tirado']]} />
            <List q={artists} empty="Sem pedidos aqui." render={(a) => <ArtistCard key={a.userId} a={a} can={can} ask={setAsking} done={done} />} />
          </>
        )}
        {tab === 'tracks' && (
          <>
            <Filter<TrackStatus> value={tStatus} onChange={setTStatus} options={[['pending', 'Por moderar'], ['held', 'Escondidas por denúncia'], ['approved', 'Aprovadas'], ['withdrawn', 'Retiradas pelo artista'], ['rejected', 'Recusadas'], ['removed', 'Tiradas']]} />
            <List q={tracks} empty="Sem faixas aqui." render={(t) => <TrackCard key={t.id} t={t} can={can} ask={setAsking} done={done} />} />
          </>
        )}
        {tab === 'claims' && (
          <>
            <Filter<ClaimStatus> value={cStatus} onChange={setCStatus} options={[['open', 'Por decidir'], ['upheld', 'Com razão'], ['dismissed', 'Sem razão']]} />
            <List q={claims} empty="Sem denúncias aqui." render={(c) => <ClaimCard key={c.id} c={c} can={can} ask={setAsking} />} />
          </>
        )}
      </div>
      {asking && (
        <ReasonDialog
          title={asking.title}
          help={asking.help}
          confirm={asking.confirm}
          danger={asking.danger}
          onCancel={() => setAsking(null)}
          onConfirm={async (reason) => {
            await asking.run(reason);
            setAsking(null);
            done();
          }}
        />
      )}
    </>
  );
}
