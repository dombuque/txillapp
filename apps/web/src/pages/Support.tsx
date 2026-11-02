import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon, { type IconName } from '../components/Icon';
import StackPage from '../components/StackPage';
import VerifiedBadge from '../components/VerifiedBadge';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const SUPPORT = 'suporte@txillapp.com';

/** Uma linha de lista, no mesmo estilo das Definições. */
function Line({ icon, label, value, to, href, onClick }: { icon: IconName; label: string; value?: ReactNode; to?: string; href?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800" aria-hidden><Icon name={icon} /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {value && <span className="block truncate text-sm text-zinc-500">{value}</span>}
      </span>
      {(to || href || onClick) && <span className="text-xl text-zinc-400" aria-hidden>›</span>}
    </>
  );
  const cls = 'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-zinc-50';
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (href) return <a href={href} className={cls}>{inner}</a>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

const Group = ({ title, children }: { title?: string; children: ReactNode }) => (
  <section className="mt-5">
    {title && <h2 className="mb-1.5 px-5 text-[13px] font-bold uppercase tracking-wider text-zinc-500">{title}</h2>}
    <div className="mx-4 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">{children}</div>
  </section>
);

/** Sobre: a tua conta, a política de privacidade, os termos e a versão. */
export function About() {
  const { user } = useAuth();
  const me = useQuery({ queryKey: ['profile', user?.username], queryFn: () => api.profile(user!.username), enabled: !!user });
  const ver = useQuery({ queryKey: ['verification'], queryFn: api.verificationStatus, staleTime: 60_000 });
  const geo = useQuery({ queryKey: ['geo'], queryFn: api.geo, staleTime: 5 * 60_000 });
  const since = me.data?.joinedAt ? new Date(me.data.joinedAt).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' }) : '…';
  let country = geo.data?.country ?? '';
  try {
    if (country) country = new Intl.DisplayNames(['pt'], { type: 'region' }).of(country) ?? country;
  } catch {
    /* mantém o código */
  }
  return (
    <StackPage title="Sobre">
      <Group title="Sobre o teu perfil">
        <Line icon="user" label="Nome de utilizador" value={`@${user?.username ?? ''}`} />
        <Line icon="clock" label="Conta criada em" value={since} />
        {country && <Line icon="globe" label="Região" value={country} />}
        <Line icon="check-circle" label="Verificação" value={ver.data?.verified ? (ver.data.tier === 'official' ? 'Conta oficial do Txillapp' : 'Conta verificada') : 'Sem selo'} to="/verification" />
      </Group>
      <Group title="Legal">
        <Line icon="shield" label="Política de privacidade" to="/privacy" />
        <Line icon="file-text" label="Termos de utilização" to="/terms" />
      </Group>
      <Group title="Txillapp">
        <Line icon="info" label="Versão" value={`de ${__BUILD__}`} />
        <Line icon="mail" label="Contactar-nos" value={SUPPORT} href={`mailto:${SUPPORT}`} />
      </Group>
      <p className="mx-6 mt-6 text-center text-sm text-zinc-500">
        O Txillapp é a rede da malta: fotos, vídeos, stories, reels e chat, com Txills para brindar e presentear. {user && ver.data?.verified && <VerifiedBadge size={14} tier={ver.data.tier} />}
      </p>
    </StackPage>
  );
}

const FAQ: { q: string; a: string }[] = [
  { q: 'O que são os Txills?', a: 'São a moeda de brincadeira do Txillapp. Servem para presentear quem segues e agradecer um bom post. Por agora são uma demonstração: não valem dinheiro.' },
  { q: 'Como funcionam os brindes?', a: 'Tocas em "Brindar" num post ou reel para mostrar que gostaste. É grátis e a pessoa é avisada.' },
  { q: 'Como presenteio alguém?', a: 'Só podes presentear quem segues. Abre o perfil ou o post e toca em "Presentear". Podes deixar o presente em silêncio, privado ou publicá-lo para toda a gente ver.' },
  { q: 'O que é a geleira?', a: 'A tua vitrine de gostos: vibes, bebidas, comidas e sítios. Edita-a em Editar perfil. Quanto mais paulada tiveres lá, mais sobe de nível.' },
  { q: 'O que é a visualização única?', a: 'Fotos, voz e mensagens que só se abrem uma vez e depois desaparecem do chat.' },
  { q: 'Como bloqueio ou denuncio alguém?', a: 'No perfil, toca nos três pontos e escolhe Bloquear. Para denunciar um post, comentário ou conversa, usa o menu dele e escolhe Denunciar. A moderação vê o pedido.' },
  { q: 'Como pedir o selo de verificado?', a: 'Em Definições, Verificação. A conta tem de cumprir alguns requisitos e depois enviamos o pedido com um documento e uma selfie, que a moderação revê. Os documentos são apagados quando há decisão.' },
  { q: 'Quem vê quando estou online?', a: 'Só quem também mostra a presença. Em Definições, "Mostrar quando estou online" desliga isso (e também deixas de ver os outros).' },
  { q: 'Como mudo a privacidade da conta?', a: 'Em Definições, Privacidade da conta: perfil público ou privado, quem comenta, quem te menciona e quem te envia mensagens.' },
  { q: 'Esqueci-me da senha. E agora?', a: 'No ecrã de entrada, toca em "Esqueci-me da senha". Enviamos-te um email para criares uma nova.' },
  { q: 'Como elimino a minha conta?', a: 'Em Definições, Conta, "Eliminar conta". Podes descarregar os teus dados antes, na mesma secção.' },
];

/** Ajuda: perguntas frequentes e contacto. */
export function Help() {
  const [open, setOpen] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const list = FAQ.filter((f) => !term.trim() || `${f.q} ${f.a}`.toLowerCase().includes(term.trim().toLowerCase()));
  const subject = encodeURIComponent('Problema no Txillapp');
  const body = encodeURIComponent(`\n\n---\nVersão: ${__BUILD__}\nAparelho: ${navigator.userAgent}`);
  return (
    <StackPage title="Ajuda">
      <div className="px-4 pt-4">
        <label className="flex h-11 items-center gap-2 rounded-full bg-zinc-100 px-4 text-zinc-500 focus-within:bg-zinc-200/70">
          <Icon name="search" size={18} />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Procurar na ajuda" aria-label="Procurar na ajuda" className="min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-500" />
        </label>
      </div>
      <Group title="Perguntas frequentes">
        {list.length === 0 && <p className="px-4 py-6 text-center text-zinc-500">Nada com essa palavra. Fala connosco, em baixo.</p>}
        {list.map((f, i) => (
          <div key={f.q}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-zinc-50">
              <span className="flex-1 font-semibold">{f.q}</span>
              <Icon name="chevron-right" size={18} className={`shrink-0 text-zinc-400 transition-transform ${open === i ? 'rotate-90' : ''}`} />
            </button>
            {open === i && <p className="px-4 pb-4 text-[15px] leading-snug text-zinc-700">{f.a}</p>}
          </div>
        ))}
      </Group>
      <Group title="Fala connosco">
        <Line icon="mail" label="Contactar o suporte" value={SUPPORT} href={`mailto:${SUPPORT}`} />
        <Line icon="alert" label="Reportar um problema" value="Já leva a versão e o aparelho" href={`mailto:${SUPPORT}?subject=${subject}&body=${body}`} />
        <Line icon="shield" label="Segurança e privacidade" to="/privacy" />
      </Group>
    </StackPage>
  );
}

/** Pedidos e pagamentos: o saldo e histórico de Txills e o que vem a seguir. */
export function Orders() {
  const w = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  return (
    <StackPage title="Pedidos e pagamentos">
      <div className="mx-4 mt-4 rounded-3xl bg-gradient-to-br from-brand via-[#e8475f] to-[#ff8a5b] p-5 text-white shadow-[0_6px_18px_rgba(214,51,79,0.3)]">
        <p className="text-sm font-semibold text-white/85">O teu saldo</p>
        <p className="mt-1 text-[38px] font-black leading-none">{w.data ? w.data.balance.toLocaleString('pt-PT') : '…'} <span className="text-xl font-bold">Txills</span></p>
        <Link to="/wallet" className="mt-4 inline-flex h-10 items-center rounded-full bg-white/20 px-4 text-sm font-bold active:scale-95">Ver movimentos e presentes</Link>
      </div>
      <Group title="Pagamentos">
        <Line icon="wallet" label="Comprar Txills" value="Em breve" />
        <Line icon="gift" label="Métodos de pagamento" value="Formas de pagar locais, em breve" />
      </Group>
      <Group title="Pedidos">
        <Line icon="file-text" label="Histórico de pedidos" value="Ainda não tens pedidos" />
      </Group>
      <p className="mx-6 mt-5 text-center text-sm text-zinc-500">Por agora os Txills são uma demonstração e não valem dinheiro. Quando houver pagamentos a sério, os teus pedidos e recibos ficam aqui.</p>
    </StackPage>
  );
}

const LANGS = [
  { id: 'pt-MZ', label: 'Português (Moçambique)', ready: true },
  { id: 'pt-PT', label: 'Português (Portugal)', ready: true },
  { id: 'en', label: 'English', ready: false },
  { id: 'fr', label: 'Français', ready: false },
] as const;
const KEY = 'txill_lang';
const stored = () => {
  try {
    return localStorage.getItem(KEY) ?? 'pt-MZ';
  } catch {
    return 'pt-MZ';
  }
};

/** Idioma e traduções: o idioma da app e a tradução de publicações. */
export function Language() {
  const [lang, setLang] = useState(stored);
  function pick(id: string) {
    setLang(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* sem armazenamento: só vale agora */
    }
    document.documentElement.lang = id;
  }
  return (
    <StackPage title="Idioma e traduções">
      <Group title="Idioma da app">
        {LANGS.map((l) => (
          <button key={l.id} type="button" disabled={!l.ready} onClick={() => pick(l.id)} role="radio" aria-checked={lang === l.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-zinc-50 disabled:opacity-55">
            <span className="flex-1 font-semibold">{l.label}{!l.ready && <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-500">em breve</span>}</span>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${lang === l.id ? 'border-brand bg-brand text-white' : 'border-zinc-300'}`} aria-hidden>{lang === l.id && <Icon name="check" size={14} strokeWidth={3} />}</span>
          </button>
        ))}
      </Group>
      <Group title="Traduções">
        <Line icon="globe" label="Traduzir publicações" value="Em breve: ver posts e comentários noutro idioma com um toque" />
      </Group>
      <p className="mx-6 mt-5 text-center text-sm text-zinc-500">Por agora o Txillapp está em português. Vamos acrescentando idiomas e a tradução de publicações.</p>
    </StackPage>
  );
}
