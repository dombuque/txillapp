import { inviteShare, shareNow } from '../lib/share';
import { tr } from '../lib/i18n';
import { LoadingBlock } from '../components/Loading';
import { APP_URL, useInstall } from '../lib/install';
import PushToggle from '../components/PushToggle';
import Icon from '../components/Icon';
import VerifiedBadge from '../components/VerifiedBadge';
import { Link } from 'react-router-dom';
import FindContacts from '../components/FindContacts';
import GenderPicker, { genderLabel } from '../components/GenderPicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import CloseFriendsSheet from '../components/CloseFriendsSheet';
import EditProfileSheet from '../components/EditProfileSheet';
import StackPage from '../components/StackPage';
import { checkForUpdate, hardReload } from '../components/UpdateBanner';
import { Avatar, Sheet, btnGhost, btnPrimary, fieldInput, timeAgo } from '../components/ui';
import { ApiError, api, type PrivacySettings, type Who, type Viewers } from '../lib/api';
import { useAuth } from '../lib/auth';

type SheetName = null | 'contacts' | 'gender' | 'edit' | 'type' | 'comments' | 'gifts' | 'connections' | 'storyReplies' | 'hidden' | 'mentions' | 'dms' | 'closeFriends' | 'repostsVisible' | 'cheersVisible' | 'giftsVisible' | 'blocked' | 'password' | 'devices' | 'delete' | 'logout';

const VIEWERS: { value: Viewers; title: string; text: string }[] = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa que veja a publicação.' },
  { value: 'followers', title: 'Só os meus seguidores', text: 'Quem me segue.' },
  { value: 'off', title: 'Só eu', text: 'Mais ninguém vê os nomes.' },
];
const viewersLabel = (v: Viewers) => VIEWERS.find((x) => x.value === v)!.title;

const WHO: { value: Who; title: string; text: string }[] = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa.' },
  { value: 'following', title: 'Quem eu sigo', text: 'Só as pessoas que segues.' },
  { value: 'off', title: 'Ninguém', text: 'Desativado.' },
];
const whoLabel = (w: Who) => WHO.find((o) => o.value === w)!.title;
const CONNECTIONS = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa que veja o teu perfil.' },
  { value: 'followers', title: 'Só seguidores', text: 'Quem te segue.' },
  { value: 'me', title: 'Só eu', text: 'Ninguém mais vê estas listas.' },
] as const;

/** Linha de definição: ícone, nome, valor atual e seta. */
function Row({ icon, label, value, onClick, danger }: { icon: ReactNode; label: string; value?: string; onClick?: () => void; danger?: boolean }) {
  if (!onClick) {
    // Só para ver: não se altera (por exemplo, o que se escolheu ao criar a conta).
    return (
      <div className="flex min-h-[56px] w-full items-center gap-3.5 px-4 py-3 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden>{icon}</span>
        <span className="min-w-0 flex-1 text-[16px] font-medium">{label}</span>
        {value && <span className="max-w-[40%] truncate text-sm text-zinc-600">{value}</span>}
        <Icon name="lock" size={16} className="text-zinc-400" aria-hidden />
      </div>
    );
  }
  return (
    <button onClick={onClick} className={`flex min-h-[56px] w-full items-center gap-3.5 px-4 py-3 text-left transition active:bg-zinc-50 ${danger ? 'text-red-700' : ''}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-red-50 text-red-700' : 'bg-zinc-100 text-zinc-800'}`} aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1 text-[16px] font-medium">{label}</span>
      {value && <span className="max-w-[40%] truncate text-sm text-zinc-600">{value}</span>}
      <span className="text-xl text-zinc-400" aria-hidden>›</span>
    </button>
  );
}

/** Convidar amigos: abre o menu de partilha com a mensagem já escrita e o link do Txillapp. */
function InviteRow() {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  async function invite() {
    const r = await shareNow(inviteShare(user?.displayName.split(' ')[0]));
    setNote(r === 'copied' ? 'Texto e link copiados' : r === 'failed' ? 'Não consegui copiar' : '');
    if (r === 'copied' || r === 'failed') setTimeout(() => setNote(''), 2500);
  }
  return <Row icon={<Icon name="user-plus" />} label={tr('Convidar amigos')} value={note} onClick={() => void invite()} />;
}

/** Mostra o país onde estás: é a rede que vês (o que é de outros países só aparece se seguires a pessoa). */
function RegionInfo() {
  const geo = useQuery({ queryKey: ['geo'], queryFn: api.geo, staleTime: 5 * 60_000 });
  const code = geo.data?.country;
  let name = 'Não consegui saber';
  if (code) {
    try {
      name = new Intl.DisplayNames(['pt'], { type: 'region' }).of(code) ?? code;
    } catch {
      name = code;
    }
  }
  return (
    <div className="flex min-h-[56px] w-full items-center gap-3.5 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="map-pin" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium">{tr('A tua região:')} {geo.isLoading ? '…' : name}</span>
        <span className="block text-sm text-zinc-600">{tr('Cada país é a sua rede: sugestões, reels e pesquisa mostram o que é daqui. Quem segues vês sempre.')}</span>
      </span>
    </div>
  );
}

function Toggle({ icon, label, text, on, onChange }: { icon: ReactNode; label: string; text: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-[56px] items-center gap-3.5 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium">{label}</span>
        <span className="block text-sm text-zinc-600">{text}</span>
      </span>
      <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-zinc-300'}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6" aria-label={title}>
      <h2 className="px-5 pb-2 text-sm font-bold uppercase tracking-wide text-zinc-600">{title}</h2>
      <div className="mx-4 divide-y divide-zinc-100 overflow-hidden rounded-[24px] bg-white shadow-[0_2px_16px_rgba(0,0,0,0.09)]">{children}</div>
    </section>
  );
}

/** Folha de escolha única (rádio) que aplica logo ao tocar. */
function ChoiceSheet<T extends string>({ title, intro, options, value, onPick, onClose }: { title: string; intro?: string; options: readonly { value: T; title: string; text: string }[]; value: T; onPick: (v: T) => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {intro && <p className="-mt-2 mb-3 text-sm text-zinc-600">{intro}</p>}
      <div role="radiogroup" aria-label={title} className="space-y-2">
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            onClick={() => { onPick(o.value); onClose(); }}
            className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition active:scale-[0.99] ${value === o.value ? 'border-brand bg-rose-50' : 'border-zinc-200'}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{o.title}</span>
              <span className="block text-sm text-zinc-600">{o.text}</span>
            </span>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${value === o.value ? 'border-brand bg-brand text-sm text-white' : 'border-zinc-300'}`} aria-hidden>{value === o.value && <Icon name="check" size={14} strokeWidth={3} />}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** "Instalar a app" nas definições: botão no Android, instruções no iPhone, e "instalada" quando já está. */
function InstallRow() {
  const { installed, canPrompt, iosHint, iosOpenInSafari, goToApp, install } = useInstall();
  if (installed) return <Row icon={<Icon name="check-circle" />} label={tr('App instalada')} onClick={() => undefined} />;
  if (goToApp) return <Row icon={<Icon name="phone" />} label={tr('Instalar a app')} onClick={() => window.location.assign(APP_URL)} />;
  if (!canPrompt && !iosHint && !iosOpenInSafari) return null;
  const how = iosHint
    ? 'No Safari: toca em Partilhar (o quadrado com a seta) e depois em "Adicionar ao ecrã principal".'
    : 'Para instalar no iPhone, abre este endereço no Safari.';
  return <Row icon={<Icon name="phone" />} label={tr('Instalar a app')} onClick={() => (canPrompt ? void install() : window.alert(how))} />;
}

/** A versão da app e o botão para procurar já uma atualização (e, se ficar presa, recarregar do zero). */
function VersionRow() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'updating' | 'error'>('idle');
  async function check() {
    setState('checking');
    setState(await checkForUpdate());
  }
  return (
    <div className="mt-2 px-4 text-center text-xs text-zinc-500">
      <p>{tr('Txillapp · versão de')} {__BUILD__}</p>
      <button type="button" onClick={check} disabled={state === 'checking' || state === 'updating'} className="mt-1.5 h-9 rounded-full px-4 text-sm font-semibold text-brand active:bg-rose-50 disabled:opacity-60">
        {state === 'checking' ? 'A procurar…' : state === 'updating' ? 'A atualizar…' : 'Procurar atualização'}
      </button>
      {state === 'latest' && <p role="status" className="text-zinc-600">{tr('Já tens a versão mais recente.')}</p>}
      {state === 'error' && <p role="alert" className="text-red-600">{tr('Não consegui procurar. Tenta outra vez.')}</p>}
      {(state === 'latest' || state === 'error') && (
        <button type="button" onClick={() => void hardReload()} className="mt-1 block w-full text-center text-xs font-semibold text-zinc-600 underline">{tr('Ainda vês a versão antiga? Recarregar do zero')}</button>
      )}
    </div>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const { user, signOut, signIn } = useAuth();
  const [sheet, setSheet] = useState<SheetName>(null);
  const close = () => setSheet(null);

  const profile = useQuery({ queryKey: ['profile', user!.username], queryFn: () => api.profile(user!.username) });
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: api.privacy });
  const stories = useQuery({ queryKey: ['story-settings'], queryFn: api.storySettings });
  const closeFriends = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends });
  const blocked = useQuery({ queryKey: ['blocked'], queryFn: api.blocked });
  const p = privacy.data;
  const ver = useQuery({ queryKey: ['verification'], queryFn: api.verificationStatus, staleTime: 60_000 });

  const [exporting, setExporting] = useState(false);
  async function downloadData() {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `txillapp-dados-${user!.username}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (x) {
      window.alert((x as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function savePrivacy(patch: Partial<PrivacySettings>) {
    const prev = p;
    if (prev) qc.setQueryData(['privacy'], { ...prev, ...patch }); // optimista
    try {
      qc.setQueryData(['privacy'], await api.setPrivacy(patch));
      for (const key of ['profile', 'feed', 'suggestions']) qc.invalidateQueries({ queryKey: [key] });
    } catch {
      qc.setQueryData(['privacy'], prev);
    }
  }
  async function saveStoryReplies(replies: Who) {
    qc.setQueryData(['story-settings'], await api.setStoryReplies(replies));
  }

  return (
    <StackPage title={tr('Definições e privacidade')}>
      {profile.data && (
        <button onClick={() => setSheet('edit')} className="mx-4 mt-2 flex w-[calc(100%-2rem)] items-center gap-4 rounded-[24px] bg-white p-4 text-left shadow-[0_2px_16px_rgba(0,0,0,0.09)] transition active:scale-[0.99]">
          <Avatar name={profile.data.displayName} username={user!.username} size={60} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-extrabold">{profile.data.displayName}</span>
            <span className="block truncate text-sm text-zinc-600">@{user!.username}</span>
            <span className="text-sm font-semibold text-brand">{tr('Editar perfil e foto')}</span>
          </span>
          <span className="text-xl text-zinc-400" aria-hidden>›</span>
        </button>
      )}

      <Section title={tr('Carteira')}>
        <Link to="/wallet" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-zinc-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="wallet" /></span>
          <span className="flex-1 font-semibold">{tr('Txills e presentes')}</span>
          <span className="text-xl text-zinc-400" aria-hidden>›</span>
        </Link>
      </Section>

      <Section title={tr('Verificação')}>
        <Link to="/verification" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-zinc-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50" aria-hidden><VerifiedBadge size={22} tier={ver.data?.tier} /></span>
          <span className="flex-1 font-semibold">{ver.data?.verified ? 'A tua conta está verificada' : 'Pedir o selo de verificado'}</span>
          <span className="text-xl text-zinc-400" aria-hidden>›</span>
        </Link>
      </Section>

      <Section title={tr('Privacidade da conta')}>
        <Row icon={<Icon name={p?.isPrivate ? 'lock' : 'globe'} />} label={tr('Tipo de perfil')} value={p ? (p.isPrivate ? 'Privado' : 'Público') : '…'} onClick={() => setSheet('type')} />
        <Row icon={<Icon name="user-circle" />} label={tr('Como me identifico')} value={p ? (p.gender ? genderLabel(p.gender) : 'Por escolher') : '…'} onClick={p && !p.gender ? () => setSheet('gender') : undefined} />
        {p && p.gender && p.gender !== 'unspecified' && <Toggle icon={<Icon name="user" />} label={tr('Mostrar no perfil')} text={tr('Quem vê o teu perfil vê também isto.')} on={p.showGender} onChange={(v) => savePrivacy({ showGender: v })} />}
        <Row icon={<Icon name="block" />} label={tr('Contas bloqueadas')} value={blocked.data ? String(blocked.data.length) : '…'} onClick={() => setSheet('blocked')} />
        <Row icon={<Icon name="users" />} label={tr('Quem vê seguidores e a quem sigo')} value={p ? CONNECTIONS.find((c) => c.value === p.showConnections)!.title : '…'} onClick={() => setSheet('connections')} />
        {p && <Toggle icon={<Icon name="sparkles" />} label={tr('Aparecer nas sugestões')} text={tr('Outras pessoas podem descobrir-te.')} on={p.suggestable} onChange={(v) => savePrivacy({ suggestable: v })} />}
        {p && <Toggle icon={<Icon name="eye" />} label={tr('Mostrar quando estou online')} text={tr('Aparece Online ou Visto há… no chat. Se desligares, também não vês o dos outros.')} on={p.showPresence} onChange={(v) => savePrivacy({ showPresence: v })} />}
      </Section>

      <Section title={tr('Interações')}>
        <Row icon={<Icon name="comment" />} label={tr('Quem pode comentar')} value={p ? whoLabel(p.commentsAllowed) : '…'} onClick={() => setSheet('comments')} />
        <Row icon={<Icon name="repeat" />} label={tr('Quem vê quem repostou')} value={p ? viewersLabel(p.repostsVisible) : '…'} onClick={() => setSheet('repostsVisible')} />
        <Row icon={<Icon name="cheers" />} label={tr('Quem vê quem brindou')} value={p ? viewersLabel(p.cheersVisible) : '…'} onClick={() => setSheet('cheersVisible')} />
        <Row icon={<Icon name="gift" />} label={tr('Quem vê quem presenteou')} value={p ? viewersLabel(p.giftsVisible) : '…'} onClick={() => setSheet('giftsVisible')} />
        <Row icon={<Icon name="mail" />} label={tr('Quem pode enviar-me mensagens')} value={p ? whoLabel(p.dmsAllowed) : '…'} onClick={() => setSheet('dms')} />
        <Row icon={<Icon name="at" />} label={tr('Quem pode mencionar-me')} value={p ? whoLabel(p.mentionsAllowed) : '…'} onClick={() => setSheet('mentions')} />
        <Row icon={<Icon name="gift" />} label={tr('Quem pode presentear-me')} value={p ? whoLabel(p.giftsAllowed) : '…'} onClick={() => setSheet('gifts')} />
      </Section>

      <Section title={tr('Stories')}>
        <Row icon={<Icon name="camera" />} label={tr('Quem pode responder')} value={stories.data ? whoLabel(stories.data.replies) : '…'} onClick={() => setSheet('storyReplies')} />
        <Row icon={<Icon name="heart" />} label={tr('Amigos próximos')} value={closeFriends.data ? String(closeFriends.data.length) : '…'} onClick={() => setSheet('closeFriends')} />
        <Row icon={<Icon name="eye-off" />} label={tr('Esconder story de…')} value={stories.data ? String(stories.data.hidden.length) : '…'} onClick={() => setSheet('hidden')} />
      </Section>

      <Section title={tr('Convidar')}>
        <InviteRow />
        <Row icon={<Icon name="users" />} label={tr('Encontrar amigos nos contactos')} onClick={() => setSheet('contacts')} />
        {p && <Toggle icon={<Icon name="search" />} label={tr('Deixar que me encontrem pelos contactos')} text={tr('Quem tem o teu email nos contactos pode sugerir-te a seguir. Só vê que estás no Txillapp.')} on={p.findByContacts} onChange={(v) => savePrivacy({ findByContacts: v })} />}
      </Section>

      <Section title={tr('Região')}>
        <RegionInfo />
      </Section>

      <Section title={tr('Notificações')}>
        <InstallRow />
        <PushToggle />
      </Section>

      <Section title={tr('Privacidade dos dados')}>
        {p && <Toggle icon={<Icon name="info" />} label={tr('Ajudar a melhorar o Txillapp')} text={tr('Estatísticas de uso anónimas, só nossas (aberturas, ecrãs, erros). Nunca o conteúdo.')} on={p.shareAnalytics} onChange={(v) => savePrivacy({ shareAnalytics: v })} />}
      </Section>

      <Section title={tr('Segurança')}>
        <Row icon={<Icon name="key" />} label={tr('Alterar senha')} onClick={() => setSheet('password')} />
        <Row icon={<Icon name="phone" />} label={tr('Dispositivos com sessão iniciada')} onClick={() => setSheet('devices')} />
      </Section>

      {p?.isAdmin && (
        <Section title={tr('Moderação')}>
          <Link to="/admin/stats" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-zinc-50">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="sparkles" /></span>
            <span className="flex-1 font-semibold">{tr('Estatísticas')}</span>
            <span className="text-xl text-zinc-400" aria-hidden>›</span>
          </Link>
          <Link to="/admin/verifications" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-zinc-50">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="check-circle" /></span>
            <span className="flex-1 font-semibold">{tr('Pedidos de verificação')}</span>
            <span className="text-xl text-zinc-400" aria-hidden>›</span>
          </Link>
          <Link to="/admin" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-zinc-50">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="shield" /></span>
            <span className="flex-1 font-semibold">{tr('Fila de denúncias')}</span>
            <span className="text-xl text-zinc-400" aria-hidden>›</span>
          </Link>
        </Section>
      )}

      <Section title={tr('Apoio e informações')}>
        <Link to="/help" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-zinc-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="info" /></span>
          <span className="flex-1 font-semibold">{tr('Ajuda')}</span>
          <span className="text-xl text-zinc-400" aria-hidden>›</span>
        </Link>
        <Link to="/orders" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-zinc-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="wallet" /></span>
          <span className="flex-1 font-semibold">{tr('Pedidos e pagamentos')}</span>
          <span className="text-xl text-zinc-400" aria-hidden>›</span>
        </Link>
        <Link to="/language" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-zinc-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="globe" /></span>
          <span className="flex-1 font-semibold">{tr('Idioma e traduções')}</span>
          <span className="text-xl text-zinc-400" aria-hidden>›</span>
        </Link>
        <Link to="/about" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-zinc-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name="shield" /></span>
          <span className="flex-1 font-semibold">{tr('Sobre')}</span>
          <span className="text-sm text-zinc-500">{tr('Perfil, privacidade e termos')}</span>
          <span className="text-xl text-zinc-400" aria-hidden>›</span>
        </Link>
      </Section>

      <VersionRow />

      <Section title={tr('Conta')}>
        <Row icon={<Icon name="download" />} label={exporting ? 'A preparar…' : 'Descarregar os meus dados'} onClick={downloadData} />
        <Row icon={<Icon name="logout" />} label={tr('Terminar sessão')} onClick={() => setSheet('logout')} />
        <Row icon={<Icon name="trash" />} label={tr('Eliminar conta')} danger onClick={() => setSheet('delete')} />
      </Section>

      {sheet === 'contacts' && <FindContacts onClose={close} />}
      {sheet === 'gender' && p && (
        <Sheet title={tr('Como te identificas?')} onClose={close}>
          <GenderPicker value={p.gender} onChange={(g) => { void savePrivacy({ gender: g, ...(g === 'unspecified' ? { showGender: false } : {}) }); close(); }} />
        </Sheet>
      )}
      {sheet === 'edit' && profile.data && <EditProfileSheet profile={profile.data} onClose={close} />}
      {sheet === 'type' && p && (
        <ChoiceSheet
          title={tr('Tipo de perfil')}
          intro={tr('Num perfil privado só vê o teu conteúdo quem aprovares; seguir passa a ser um pedido.')}
          options={[{ value: 'public', title: 'Público', text: 'Qualquer pessoa vê as tuas publicações e stories.' }, { value: 'private', title: 'Privado', text: 'Só os seguidores aprovados.' }]}
          value={p.isPrivate ? 'private' : 'public'}
          onPick={(v) => savePrivacy({ isPrivate: v === 'private' })}
          onClose={close}
        />
      )}
      {sheet === 'comments' && p && <ChoiceSheet title={tr('Quem pode comentar')} intro={tr('Aplica-se às tuas publicações. Os comentários que já existem mantêm-se.')} options={WHO} value={p.commentsAllowed} onPick={(v) => savePrivacy({ commentsAllowed: v })} onClose={close} />}
      {sheet === 'mentions' && p && <ChoiceSheet title={tr('Quem pode mencionar-me')} intro={tr('Quem escreve @{o teu nome} e te faz aparecer nas sugestões. Quem eu sigo mantém-se sempre disponível para mim; contas privadas só são mencionadas por quem as segue.')} options={WHO} value={p.mentionsAllowed} onPick={(v) => savePrivacy({ mentionsAllowed: v })} onClose={close} />}
      {sheet === 'repostsVisible' && p && <ChoiceSheet title={tr('Quem vê quem repostou')} intro={tr('Os números continuam visíveis; isto muda só quem pode ver os nomes.')} options={VIEWERS} value={p.repostsVisible} onPick={(v) => savePrivacy({ repostsVisible: v })} onClose={close} />}
      {sheet === 'cheersVisible' && p && <ChoiceSheet title={tr('Quem vê quem brindou')} intro={tr('Os números continuam visíveis; isto muda só quem pode ver os nomes.')} options={VIEWERS} value={p.cheersVisible} onPick={(v) => savePrivacy({ cheersVisible: v })} onClose={close} />}
      {sheet === 'giftsVisible' && p && <ChoiceSheet title={tr('Quem vê quem presenteou')} intro={tr('Os números continuam visíveis; isto muda só quem pode ver os nomes (nunca os valores).')} options={VIEWERS} value={p.giftsVisible} onPick={(v) => savePrivacy({ giftsVisible: v })} onClose={close} />}
      {sheet === 'dms' && p && <ChoiceSheet title={tr('Quem pode enviar-me mensagens')} intro={tr('Só trava conversas novas: as que já existem continuam. As respostas aos teus stories seguem a definição dos stories.')} options={WHO} value={p.dmsAllowed} onPick={(v) => savePrivacy({ dmsAllowed: v })} onClose={close} />}
      {sheet === 'closeFriends' && <CloseFriendsSheet onClose={close} />}
      {sheet === 'gifts' && p && <ChoiceSheet title={tr('Quem pode presentear-me')} options={WHO} value={p.giftsAllowed} onPick={(v) => savePrivacy({ giftsAllowed: v })} onClose={close} />}
      {sheet === 'connections' && p && <ChoiceSheet title={tr('Quem vê seguidores e a quem sigo')} intro={tr('Os números continuam visíveis; muda só quem pode ver as listas.')} options={CONNECTIONS} value={p.showConnections} onPick={(v) => savePrivacy({ showConnections: v })} onClose={close} />}
      {sheet === 'storyReplies' && stories.data && <ChoiceSheet title={tr('Respostas aos stories')} intro={tr('Quem pode responder ou reagir aos teus stories.')} options={WHO} value={stories.data.replies} onPick={saveStoryReplies} onClose={close} />}
      {sheet === 'hidden' && <HiddenSheet onClose={close} />}
      {sheet === 'blocked' && <BlockedSheet onClose={close} />}
      {sheet === 'password' && <PasswordSheet onClose={close} onDone={(r) => signIn(r)} />}
      {sheet === 'devices' && <DevicesSheet onClose={close} />}
      {sheet === 'delete' && <DeleteSheet username={user!.username} onClose={close} onDeleted={() => signOut()} />}
      {sheet === 'logout' && (
        <Sheet title={tr('Terminar sessão')} onClose={close}>
          <p className="py-2 text-center text-lg">{tr('Já vais?')}</p>
          <p className="mb-5 text-center text-zinc-600">{tr('Vais precisar de entrar outra vez para voltar.')}</p>
          <button onClick={signOut} className={`${btnPrimary} w-full py-4 text-lg`}>{tr('Sim, sair')}</button>
          <button onClick={close} className={`${btnGhost} mt-3 w-full py-3.5`}>{tr('Fico por aqui')}</button>
        </Sheet>
      )}
    </StackPage>
  );
}

/** Pessoas a quem escondo os meus stories. */
function HiddenSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['story-settings'], queryFn: api.storySettings });
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    const u = name.trim().replace(/^@/, '');
    if (!u) return;
    setErr('');
    try {
      qc.setQueryData(['story-settings'], await api.hideStoryFrom(u));
      setName('');
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 404 ? 'Esse utilizador não existe' : (x as Error).message);
    }
  }
  return (
    <Sheet title={tr('Esconder story de…')} onClose={onClose}>
      <p className="-mt-2 mb-3 text-sm text-zinc-600">{tr('Estas pessoas deixam de ver os teus stories, sem serem avisadas.')}</p>
      <form onSubmit={add} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('@utilizador')} aria-label={tr('Utilizador')} autoCapitalize="none" autoCorrect="off" className={fieldInput} />
        <button disabled={!name.trim()} className="rounded-full bg-brand px-5 font-bold text-white disabled:opacity-60">{tr('Esconder')}</button>
      </form>
      <p role="alert" className="min-h-5 pt-1 text-sm text-red-600">{err}</p>
      {q.data?.hidden.length === 0 && <p className="py-6 text-center text-zinc-600">{tr('Ninguém escondido')}</p>}
      {q.data?.hidden.map((h) => (
        <div key={h.username} className="flex items-center gap-3 py-2.5">
          <Avatar name={h.displayName} username={h.username} size={44} />
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{h.displayName}</span><span className="block truncate text-sm text-zinc-600">@{h.username}</span></span>
          <button onClick={async () => qc.setQueryData(['story-settings'], await api.unhideStoryFrom(h.username))} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold active:scale-95">{tr('Mostrar')}</button>
        </div>
      ))}
    </Sheet>
  );
}

function BlockedSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['blocked'], queryFn: api.blocked });
  return (
    <Sheet title={tr('Contas bloqueadas')} onClose={onClose}>
      <p className="-mt-2 mb-3 text-sm text-zinc-600">{tr('Quem bloqueias não vê o teu conteúdo, não te pode seguir nem interagir contigo. A pessoa é avisada de que foi bloqueada.')}</p>
      {q.data?.length === 0 && <p className="py-6 text-center text-zinc-600">{tr('Não bloqueaste ninguém')}</p>}
      {q.data?.map((b) => (
        <div key={b.username} className="flex items-center gap-3 py-2.5">
          <Avatar name={b.displayName} username={b.username} size={44} />
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{b.displayName}</span><span className="block truncate text-sm text-zinc-600">@{b.username}</span></span>
          <button onClick={async () => { qc.setQueryData(['blocked'], await api.unblock(b.username)); qc.invalidateQueries({ queryKey: ['profile'] }); }} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold active:scale-95">{tr('Desbloquear')}</button>
        </div>
      ))}
    </Sheet>
  );
}

function PasswordSheet({ onClose, onDone }: { onClose: () => void; onDone: (r: Awaited<ReturnType<typeof api.changePassword>>) => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 10) return setErr('A nova senha precisa de pelo menos 10 caracteres');
    if (next !== again) return setErr('As duas senhas novas não são iguais');
    setBusy(true);
    setErr('');
    try {
      onDone(await api.changePassword(cur, next));
      setOk(true);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (ok) {
    return (
      <Sheet title={tr('Senha alterada')} onClose={onClose}>
        <p className="py-3 text-center text-zinc-700">{tr('As sessões nos outros dispositivos foram terminadas.')}</p>
        <button onClick={onClose} className={`${btnPrimary} w-full`}>{tr('Feito')}</button>
      </Sheet>
    );
  }
  return (
    <Sheet title={tr('Alterar senha')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder={tr('Senha atual')} aria-label={tr('Senha atual')} autoComplete="current-password" className={fieldInput} />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder={tr('Nova senha (mínimo 10 caracteres)')} aria-label={tr('Nova senha')} autoComplete="new-password" className={fieldInput} />
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder={tr('Repete a nova senha')} aria-label={tr('Repete a nova senha')} autoComplete="new-password" className={fieldInput} />
        <p role="alert" className="min-h-5 text-center text-sm text-red-600">{err}</p>
        <button disabled={busy || !cur || !next} className={`${btnPrimary} w-full py-3.5`}>{busy ? 'A guardar…' : 'Alterar senha'}</button>
      </form>
    </Sheet>
  );
}

function DevicesSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['devices'], queryFn: api.sessions });
  const refresh = () => qc.invalidateQueries({ queryKey: ['devices'] });
  const others = (q.data ?? []).filter((d) => !d.current);
  return (
    <Sheet title={tr('Dispositivos')} onClose={onClose}>
      <p className="-mt-2 mb-3 text-sm text-zinc-600">{tr('Sítios onde a tua conta está com sessão iniciada. Não reconheces algum? Termina-o.')}</p>
      {q.isLoading && <LoadingBlock className="py-6" />}
      {q.data?.map((d) => (
        <div key={d.id} className="flex items-center gap-3 py-2.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100" aria-hidden><Icon name={/Android|iOS/.test(d.device) ? 'phone' : 'laptop'} size={22} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{d.device}{d.current && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">{tr('Este dispositivo')}</span>}</span>
            <span className="block text-sm text-zinc-600">{tr('Última atividade')} {timeAgo(d.lastUsed).toLowerCase()}</span>
          </span>
          {!d.current && <button onClick={async () => { await api.revokeSession(d.id); refresh(); }} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold active:scale-95">{tr('Terminar')}</button>}
        </div>
      ))}
      {others.length > 0 && <button onClick={async () => { await api.revokeOtherSessions(); refresh(); }} className={`${btnGhost} mt-3 w-full`}>{tr('Terminar em todos os outros')}</button>}
    </Sheet>
  );
}

function DeleteSheet({ username, onClose, onDeleted }: { username: string; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.deleteAccount(confirm, password || undefined);
      onDeleted();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <Sheet title={tr('Eliminar conta')} onClose={onClose}>
      <div className="mb-4 rounded-2xl bg-red-50 p-4 text-sm leading-relaxed text-red-900">
        <p className="font-bold">{tr('Isto não se desfaz.')}</p>
        <ul className="mt-1 list-disc pl-5">
          <li>{tr('O teu nome, @, bio, foto e email são apagados.')}</li>
          <li>{tr('As tuas publicações deixam de aparecer.')}</li>
          <li>{tr('Seguidores, stories e notificações são removidos.')}</li>
          <li>{tr('Os movimentos de Txills ficam registados sem dados pessoais.')}</li>
        </ul>
      </div>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`Escreve @${username} para confirmar`} aria-label={tr('Confirmar o teu @')} autoCapitalize="none" autoCorrect="off" className={fieldInput} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr('A tua senha (se a conta tiver)')} aria-label={tr('Senha')} autoComplete="current-password" className={fieldInput} />
        <p role="alert" className="min-h-5 text-center text-sm text-red-600">{err}</p>
        <button disabled={busy || confirm.replace(/^@/, '').toLowerCase() !== username.toLowerCase()} className="w-full rounded-full bg-red-700 py-3.5 font-bold text-white transition active:scale-[0.98] disabled:opacity-50">
          {busy ? 'A eliminar…' : 'Eliminar a minha conta'}
        </button>
        <button type="button" onClick={onClose} className={`${btnGhost} w-full`}>{tr('Cancelar')}</button>
      </form>
    </Sheet>
  );
}
