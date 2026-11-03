import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LANGS, lang, setLang, tr, locale } from '../lib/i18n';
import { STORE_BUILD } from '../lib/build';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon, { type IconName } from '../components/Icon';
import StackPage from '../components/StackPage';
import VerifiedBadge from '../components/VerifiedBadge';
import { api, type PaymentOrder } from '../lib/api';
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
  const since = me.data?.joinedAt ? new Date(me.data.joinedAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '…';
  let country = geo.data?.country ?? '';
  try {
    if (country) country = new Intl.DisplayNames(['pt'], { type: 'region' }).of(country) ?? country;
  } catch {
    /* mantém o código */
  }
  return (
    <StackPage title={tr('Sobre')}>
      <Group title={tr('Sobre o teu perfil')}>
        <Line icon="user" label={tr('Nome de utilizador')} value={`@${user?.username ?? ''}`} />
        <Line icon="clock" label={tr('Conta criada em')} value={since} />
        {country && <Line icon="globe" label={tr('Região')} value={country} />}
        <Line icon="check-circle" label={tr('Verificação')} value={ver.data?.verified ? (ver.data.tier === 'official' ? 'Conta oficial do Txillapp' : 'Conta verificada') : 'Sem selo'} to="/verification" />
      </Group>
      <Group title={tr('Legal')}>
        <Line icon="shield" label={tr('Política de privacidade')} to="/privacy" />
        <Line icon="file-text" label={tr('Termos de utilização')} to="/terms" />
      </Group>
      <Group title={tr('Txillapp')}>
        <Line icon="info" label={tr('Versão')} value={`de ${__BUILD__}`} />
        <Line icon="mail" label={tr('Contactar-nos')} value={SUPPORT} href={`mailto:${SUPPORT}`} />
      </Group>
      <p className="mx-6 mt-6 text-center text-sm text-zinc-500">
        {tr('O Txillapp é a rede da malta: fotos, vídeos, stories, reels e chat, com Txills para brindar e presentear.')} {user && ver.data?.verified && <VerifiedBadge size={14} tier={ver.data.tier} />}
      </p>
    </StackPage>
  );
}

const FAQ: { q: string; a: string }[] = [
  { q: tr('O que são os Txills?'), a: tr('São a moeda de brincadeira do Txillapp. Servem para presentear quem segues e agradecer um bom post. Por agora são uma demonstração: não valem dinheiro.') },
  { q: tr('Como funcionam os brindes?'), a: tr('Tocas em "Brindar" num post ou reel para mostrar que gostaste. É grátis e a pessoa é avisada.') },
  { q: tr('Como presenteio alguém?'), a: tr('Só podes presentear quem segues. Abre o perfil ou o post e toca em "Presentear". Podes deixar o presente em silêncio, privado ou publicá-lo para toda a gente ver.') },
  { q: tr('O que é a geleira?'), a: tr('A tua vitrine de gostos: vibes, bebidas, comidas e sítios. Edita-a em Editar perfil. Quanto mais paulada tiveres lá, mais sobe de nível.') },
  { q: tr('O que é a visualização única?'), a: tr('Fotos, voz e mensagens que só se abrem uma vez e depois desaparecem do chat.') },
  { q: tr('Como bloqueio ou denuncio alguém?'), a: tr('No perfil, toca nos três pontos e escolhe Bloquear. Para denunciar um post, comentário ou conversa, usa o menu dele e escolhe Denunciar. A moderação vê o pedido.') },
  { q: tr('Como pedir o selo de verificado?'), a: tr('Em Definições, Verificação. A conta tem de cumprir alguns requisitos e depois enviamos o pedido com um documento e uma selfie, que a moderação revê. Os documentos são apagados quando há decisão.') },
  { q: tr('Quem vê quando estou online?'), a: tr('Só quem também mostra a presença. Em Definições, "Mostrar quando estou online" desliga isso (e também deixas de ver os outros).') },
  { q: tr('Como mudo a privacidade da conta?'), a: tr('Em Definições, Privacidade da conta: perfil público ou privado, quem comenta, quem te menciona e quem te envia mensagens.') },
  { q: tr('Esqueci-me da senha. E agora?'), a: tr('No ecrã de entrada, toca em "Esqueci-me da senha". Enviamos-te um email para criares uma nova.') },
  { q: tr('Como elimino a minha conta?'), a: tr('Em Definições, Conta, "Eliminar conta". Podes descarregar os teus dados antes, na mesma secção.') },
];

/** Ajuda: perguntas frequentes e contacto. */
export function Help() {
  const [open, setOpen] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const list = FAQ.filter((f) => !term.trim() || `${f.q} ${f.a}`.toLowerCase().includes(term.trim().toLowerCase()));
  const subject = encodeURIComponent('Problema no Txillapp');
  const body = encodeURIComponent(`\n\n---\nVersão: ${__BUILD__}\nAparelho: ${navigator.userAgent}`);
  return (
    <StackPage title={tr('Ajuda')}>
      <div className="px-4 pt-4">
        <label className="flex h-11 items-center gap-2 rounded-full bg-zinc-100 px-4 text-zinc-500 focus-within:bg-zinc-200/70">
          <Icon name="search" size={18} />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={tr('Procurar na ajuda')} aria-label={tr('Procurar na ajuda')} className="min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-500" />
        </label>
      </div>
      <Group title={tr('Perguntas frequentes')}>
        {list.length === 0 && <p className="px-4 py-6 text-center text-zinc-500">{tr('Nada com essa palavra. Fala connosco, em baixo.')}</p>}
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
      <Group title={tr('Fala connosco')}>
        <Line icon="mail" label={tr('Contactar o suporte')} value={SUPPORT} href={`mailto:${SUPPORT}`} />
        <Line icon="alert" label={tr('Reportar um problema')} value="Já leva a versão e o aparelho" href={`mailto:${SUPPORT}?subject=${subject}&body=${body}`} />
        <Line icon="shield" label={tr('Segurança e privacidade')} to="/privacy" />
      </Group>
    </StackPage>
  );
}

const money = (minor: number, currency: string) => `${(minor / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'MZN' ? 'MT' : currency}`;
const STATUS: Record<PaymentOrder['status'], { label: string; tone: string }> = {
  pending: { label: tr('À espera'), tone: 'bg-amber-100 text-amber-800' },
  paid: { label: tr('Pago'), tone: 'bg-emerald-100 text-emerald-800' },
  failed: { label: tr('Falhou'), tone: 'bg-red-100 text-red-700' },
  cancelled: { label: tr('Cancelado'), tone: 'bg-zinc-100 text-zinc-600' },
  expired: { label: tr('Expirou'), tone: 'bg-zinc-100 text-zinc-600' },
};

/** Pedidos e pagamentos: o saldo, recarregar Txills e o histórico de pedidos. */
export function Orders() {
  const qc = useQueryClient();
  const w = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  const cfg = useQuery({ queryKey: ['payments-config'], queryFn: api.paymentsConfig, staleTime: 5 * 60_000 });
  const orders = useQuery({ queryKey: ['payments-orders'], queryFn: api.paymentsOrders });
  const [pkg, setPkg] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [current, setCurrent] = useState<PaymentOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const key = useRef(crypto.randomUUID());
  const providers = cfg.data?.providers ?? [];
  const chosen = providers.find((p) => p.id === (provider ?? providers[0]?.id));
  const chosenPkg = cfg.data?.packages.find((p) => p.id === pkg);

  // Enquanto o pedido está à espera, pergunta ao servidor de 3 em 3 segundos; ao ser pago, atualiza o saldo.
  useEffect(() => {
    if (!current || current.status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        const o = await api.paymentsOrder(current.id);
        if (o.status !== 'pending') {
          setCurrent(o);
          void qc.invalidateQueries({ queryKey: ['wallet'] });
          void qc.invalidateQueries({ queryKey: ['payments-orders'] });
        }
      } catch {
        /* tenta no próximo */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [current, qc]);

  async function pay() {
    if (!chosen || !chosenPkg) return;
    setBusy(true);
    setErr('');
    try {
      const o = await api.paymentsCreate({ packageId: chosenPkg.id, provider: chosen.id, phone: chosen.needsPhone ? phone : undefined }, key.current);
      setCurrent(o);
      key.current = crypto.randomUUID(); // o próximo pedido é outro
      void qc.invalidateQueries({ queryKey: ['payments-orders'] });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  async function cancel() {
    if (!current) return;
    try {
      await api.paymentsCancel(current.id);
      setCurrent(await api.paymentsOrder(current.id));
      void qc.invalidateQueries({ queryKey: ['payments-orders'] });
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function sandboxPay() {
    if (!current) return;
    setBusy(true);
    try {
      setCurrent(await api.paymentsSandboxPay(current.id));
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['payments-orders'] });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <StackPage title={tr('Pedidos e pagamentos')}>
      <div className="mx-4 mt-4 rounded-3xl bg-gradient-to-br from-brand via-[#e8475f] to-[#ff8a5b] p-5 text-white shadow-[0_6px_18px_rgba(214,51,79,0.3)]">
        <p className="text-sm font-semibold text-white/85">{tr('O teu saldo')}</p>
        <p className="mt-1 text-[38px] font-black leading-none">{w.data ? w.data.balance.toLocaleString(locale) : '…'} <span className="text-xl font-bold">{tr('Txills')}</span></p>
        <Link to="/wallet" className="mt-4 inline-flex h-10 items-center rounded-full bg-white/20 px-4 text-sm font-bold active:scale-95">{tr('Ver movimentos e presentes')}</Link>
      </div>

      {(!STORE_BUILD || providers.length > 0) && (
      <Group title={tr('Recarregar Txills')}>
        {cfg.isLoading && <p className="px-4 py-6 text-center text-zinc-500">{tr('A carregar…')}</p>}
        {cfg.data && providers.length === 0 && !STORE_BUILD && <Line icon="wallet" label={tr('Comprar Txills')} value="Em breve: M-Pesa, e-Mola e cartão" />}
        {cfg.data && providers.length > 0 && !current && (
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-2.5">
              {cfg.data.packages.map((p) => (
                <button key={p.id} type="button" onClick={() => setPkg(p.id)} aria-pressed={pkg === p.id} className={`rounded-2xl border-2 px-3 py-3 text-left transition active:scale-[0.98] ${pkg === p.id ? 'border-brand bg-rose-50' : 'border-zinc-200'}`}>
                  <span className="block text-[22px] font-black leading-none">{p.txills.toLocaleString(locale)}</span>
                  <span className="block text-[12px] font-bold uppercase tracking-wider text-zinc-500">{tr('Txills')}</span>
                  <span className="mt-1.5 block text-[15px] font-semibold text-brand">{money(p.priceMinor, p.currency)}</span>
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label={tr('Como pagas')} className="flex flex-wrap gap-2">
              {providers.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={chosen?.id === p.id} onClick={() => setProvider(p.id)} className={`h-10 rounded-full border-2 px-4 text-sm font-semibold ${chosen?.id === p.id ? 'border-brand bg-rose-50 text-brand' : 'border-zinc-200 text-zinc-700'}`}>{p.label}</button>
              ))}
            </div>
            {chosen?.needsPhone && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">{tr('O teu número')} {chosen.label}</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="84 123 4567" className="h-12 w-full rounded-2xl border-2 border-zinc-200 px-4 text-[16px] outline-none focus:border-zinc-500" />
              </label>
            )}
            {err && <p role="alert" className="text-center text-sm text-red-600">{err}</p>}
            <button type="button" onClick={pay} disabled={busy || !chosenPkg || (chosen?.needsPhone && phone.trim().length < 9)} className="h-12 w-full rounded-full bg-brand text-[16px] font-bold text-white transition active:scale-[0.98] disabled:opacity-40">
              {busy ? tr('A preparar…') : chosenPkg ? `Pagar ${money(chosenPkg.priceMinor, chosenPkg.currency)}` : tr('Escolhe um pacote')}
            </button>
          </div>
        )}
        {current && (
          <div className="space-y-3 p-4 text-center">
            {current.status === 'pending' && (
              <>
                <p className="text-lg font-extrabold">{tr('À espera do pagamento')}</p>
                <p className="text-sm text-zinc-600">{current.provider === 'sandbox' ? tr('Pagamento de teste: confirma abaixo.') : `Confirma o pagamento no teu telemóvel${current.phoneTail ? ` (número terminado em ${current.phoneTail})` : ''}.`} {tr('Isto atualiza sozinho.')}</p>
                {current.provider === 'sandbox' && <button type="button" onClick={sandboxPay} disabled={busy} className="h-11 w-full rounded-full bg-emerald-500 font-bold text-white active:scale-[0.98] disabled:opacity-50">{tr('Simular pagamento')}</button>}
                <button type="button" onClick={cancel} className="h-11 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">{tr('Cancelar pedido')}</button>
              </>
            )}
            {current.status === 'paid' && (
              <>
                <p className="text-lg font-extrabold text-emerald-700">{tr('Pago! +')}{current.txills.toLocaleString(locale)} {tr('Txills')}</p>
                <button type="button" onClick={() => setCurrent(null)} className="h-11 w-full rounded-full bg-zinc-100 font-semibold active:scale-[0.98]">{tr('Fechar')}</button>
              </>
            )}
            {(current.status === 'failed' || current.status === 'cancelled' || current.status === 'expired') && (
              <>
                <p className="text-lg font-extrabold">{STATUS[current.status].label}</p>
                <button type="button" onClick={() => { setCurrent(null); setErr(''); }} className="h-11 w-full rounded-full bg-brand font-bold text-white active:scale-[0.98]">{tr('Tentar outra vez')}</button>
              </>
            )}
          </div>
        )}
      </Group>
      )}

      <Group title={tr('Pedidos')}>
        {orders.data && orders.data.length === 0 && <Line icon="file-text" label={tr('Histórico de pedidos')} value="Ainda não tens pedidos" />}
        {orders.data?.map((o) => (
          <div key={o.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{o.txills.toLocaleString(locale)} {tr('Txills')}</span>
              <span className="block text-sm text-zinc-500">{money(o.amountMinor, o.currency)} · {new Date(o.createdAt).toLocaleDateString(locale)}</span>
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS[o.status].tone}`}>{STATUS[o.status].label}</span>
          </div>
        ))}
      </Group>
      <p className="mx-6 mt-5 text-center text-sm text-zinc-500">{tr('Os Txills comprados entram na carteira e usam-se como os outros: para presentear quem segues. Não se trocam por dinheiro.')}</p>
    </StackPage>
  );
}

/** Idioma e traduções: o idioma da app (muda e recarrega) e a tradução de publicações. */
export function Language() {
  return (
    <StackPage title={tr('Idioma e traduções')}>
      <Group title={tr('Idioma da app')}>
        {LANGS.map((l) => (
          <button key={l.id} type="button" onClick={() => l.id !== lang && setLang(l.id)} role="radio" aria-checked={lang === l.id} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-zinc-50">
            <span className="flex-1 font-semibold">{l.label}</span>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${lang === l.id ? 'border-brand bg-brand text-white' : 'border-zinc-300'}`} aria-hidden>{lang === l.id && <Icon name="check" size={14} strokeWidth={3} />}</span>
          </button>
        ))}
        {!STORE_BUILD && <Line icon="globe" label={tr('Français')} value={tr('em breve')} />}
      </Group>
      {!STORE_BUILD && (
      <Group title={tr('Traduções')}>
        <Line icon="globe" label={tr('Traduzir publicações')} value={tr('Em breve: ver posts e comentários noutro idioma com um toque')} />
      </Group>
      )}
      <p className="mx-6 mt-5 text-center text-sm text-zinc-500">{tr('O Txillapp está em português e em inglês. Vamos acrescentando idiomas e a tradução de publicações.')}</p>
    </StackPage>
  );
}
