import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import IceRating from '../components/IceRating';
import { Sheet } from '../components/ui';
import { BackIcon } from '../components/icons';
import { api, type CatalogItem, type TasteKind, type TasteVisibility } from '../lib/api';
import { CATEGORIES, ICE, KINDS, KIND_ICON, KIND_LABEL } from '../lib/geleira';
import TasteBubble from '../components/TasteIcon';

const VIS: { v: TasteVisibility; label: string }[] = [
  { v: 'everyone', label: 'Todos' },
  { v: 'followers', label: 'Seguidores' },
  { v: 'me', label: 'Só eu' },
];
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const fmt = (n: number) => n.toLocaleString('pt-PT');

/** Quantos já tem a malta sem mim (o servidor conta-me se já tenho o item). */
const others = (i: CatalogItem) => Math.max(0, i.fans - (i.mine ? 1 : 0));

/**
 * Montar a geleira (gostos). As mudanças ficam num rascunho no ecrã e só vão para o servidor quando carregas em "Guardar";
 * se saíres com mudanças por guardar, pergunta. Uma só lista pesquisável, com separadores por tipo e grupos dentro de cada um.
 */
export default function GeleiraEditor() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const initial = (useLocation().state as { kind?: TasteKind } | null)?.kind ?? 'vibe';
  const [kind, setKind] = useState<TasteKind>(initial);
  const [text, setText] = useState('');
  const [group, setGroup] = useState<string>('todas');
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [toast, setToast] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [world, setWorld] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const geo = useQuery({ queryKey: ['geo'], queryFn: api.geo, staleTime: 10 * 60_000, retry: false });
  const countryName = (() => {
    const c = geo.data?.country;
    if (!c) return null;
    try { return new Intl.DisplayNames(['pt'], { type: 'region' }).of(c) ?? null; } catch { return null; }
  })();
  const cat = useQuery({ queryKey: ['geleira', 'catalog'], queryFn: () => api.geleiraCatalog('', undefined), staleTime: 0, gcTime: 0 });
  // O que está guardado no servidor (para saber o que mudou) e o rascunho que se vai editando.
  const [saved, setSaved] = useState<CatalogItem[] | null>(null);
  useEffect(() => {
    if (cat.data && !items) {
      setItems(cat.data);
      setSaved(cat.data);
    }
  }, [cat.data, items]);

  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };
  const edit = (id: string, patch: Partial<CatalogItem>) => setItems((l) => l && l.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  function toggle(i: CatalogItem) {
    if (i.mine) {
      edit(i.id, { mine: false, rating: null, favorite: false });
      setOpen(null);
    } else {
      edit(i.id, { mine: true });
      setOpen(i.id); // abre já para dar a nota
    }
  }
  function change(i: CatalogItem, patch: { rating?: number | null; favorite?: boolean; visibility?: TasteVisibility }) {
    edit(i.id, patch);
  }

  // Sugerir cria o item no servidor (fica pendente e já entra na tua geleira), sem tocar no resto do rascunho.
  const create = useMutation({
    mutationFn: (b: { name: string; category: string }) => api.geleiraSuggest({ ...b, kind }),
    onSuccess: (n) => {
      const fresh: CatalogItem = { ...n, mine: true, rating: null, favorite: false, visibility: 'everyone', fans: 1, region: 'global' };
      setItems((l) => (l && !l.some((i) => i.id === n.id) ? [fresh, ...l] : l));
      setSaved((l) => (l && !l.some((i) => i.id === n.id) ? [fresh, ...l] : l));
      setText('');
      setSuggesting(false);
      void qc.invalidateQueries({ queryKey: ['geleira'], refetchType: 'none' });
    },
    onError: (e) => say((e as Error).message),
  });

  // Mudanças por guardar: entrou, saiu, ou mudou nota, favorito ou visibilidade.
  const changes = useMemo(() => {
    if (!items || !saved) return [];
    const was = new Map(saved.map((i) => [i.id, i]));
    return items.filter((i) => {
      const o = was.get(i.id);
      if (!o) return false;
      return i.mine !== o.mine || (i.mine && (i.rating !== o.rating || i.favorite !== o.favorite || i.visibility !== o.visibility));
    });
  }, [items, saved]);

  async function save() {
    if (!changes.length || saving) return;
    setSaving(true);
    try {
      await Promise.all(
        changes.map((i) => (i.mine ? api.geleiraPut(i.id, { rating: i.rating, favorite: i.favorite, visibility: i.visibility }) : api.geleiraRemove(i.id))),
      );
      await qc.invalidateQueries({ queryKey: ['geleira'], refetchType: 'none' });
      leave();
    } catch {
      say('Não consegui guardar. Tenta outra vez.');
      setSaving(false);
    }
  }

  const list = items ?? [];
  const mine = list.filter((i) => i.mine);
  const count = useMemo(() => {
    const c: Record<TasteKind, number> = { vibe: 0, bebida: 0, comida: 0, sitio: 0 };
    for (const i of list) if (i.mine) c[i.kind] += 1;
    return c;
  }, [list]);

  const q = norm(text.trim());
  const groups = CATEGORIES[kind];
  // Só o que faz sentido onde estás (as do teu país e as de todo o lado); as de outros países vêm a pedido ou se já as tens.
  const inScope = (i: CatalogItem) => i.region !== 'foreign' || world || i.mine;
  const hiddenForeign = list.filter((i) => i.kind === kind && !inScope(i) && (!q || norm(i.name).includes(q))).length;
  const shown = list.filter((i) => i.kind === kind && inScope(i) && (group === 'todas' || i.category === group) && (!q || norm(i.name).includes(q)));
  const sections = useMemo(() => {
    const by = new Map<string, CatalogItem[]>();
    for (const i of shown) by.set(i.category, [...(by.get(i.category) ?? []), i]);
    const label = (slug: string) => groups.find((g) => g.slug === slug)?.label ?? slug.replace(/-/g, ' ');
    const pos = (slug: string) => { const k = groups.findIndex((g) => g.slug === slug); return k < 0 ? 99 : k; };
    return [...by.entries()].sort((a, b) => pos(a[0]) - pos(b[0])).map(([slug, rows]) => ({ slug, label: label(slug), rows }));
  }, [shown, groups]);
  const exact = shown.some((i) => norm(i.name) === q);

  const leave = () => (window.history.length > 1 ? navigate(-1) : navigate('/wallet', { replace: true }));
  const back = () => (changes.length > 0 ? setLeaving(true) : leave());

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-white">
      <header className="sticky top-0 z-20 border-b border-zinc-100 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-1 px-2 py-2">
          <button onClick={back} aria-label="Voltar" className="flex h-11 w-11 items-center justify-center rounded-full active:bg-zinc-100"><BackIcon /></button>
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-extrabold">A minha geleira</h1>
          <span aria-live="polite" className="flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-sm font-extrabold tabular-nums text-sky-700">
            <Icon name="snowflake" size={16} /> {fmt(mine.length)}
          </span>
        </div>
        <div role="tablist" aria-label="Tipo" className="grid grid-cols-4 gap-1 px-3 pb-2">
          {KINDS.map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setGroup('todas'); setOpen(null); setSuggesting(false); }} className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[12px] font-bold transition active:scale-95 ${kind === k ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
              <span className="flex items-center gap-1"><Icon name={KIND_ICON[k]} size={16} />{count[k] > 0 && <span className={`rounded-full px-1.5 text-[11px] ${kind === k ? 'bg-white/25' : 'bg-white'}`}>{count[k]}</span>}</span>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="px-3 pb-2">
          <label className="flex h-11 items-center gap-2 rounded-full bg-zinc-100 px-4 text-zinc-500 focus-within:bg-zinc-200/70">
            <Icon name="search" size={18} />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Procurar em ${KIND_LABEL[kind].toLowerCase()}…`} aria-label="Procurar" maxLength={40} className="min-w-0 flex-1 bg-transparent text-[16px] text-zinc-900 outline-none placeholder:text-zinc-500" />
            {text && <button onClick={() => setText('')} aria-label="Limpar" className="flex h-8 w-8 items-center justify-center"><Icon name="x" size={16} /></button>}
          </label>
        </div>
        <div className="flex gap-2 overflow-x-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label="Grupo">
          {[{ slug: 'todas', label: 'Tudo' }, ...groups].map((g) => (
            <button key={g.slug} role="radio" aria-checked={group === g.slug} onClick={() => setGroup(g.slug)} className={`h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition active:scale-95 ${group === g.slug ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-700'}`}>{g.label}</button>
          ))}
        </div>
        {(kind === 'bebida' || kind === 'sitio') && (hiddenForeign > 0 || world) && (
          <div className="px-3 pb-3">
            <button onClick={() => setWorld(!world)} aria-pressed={world} className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-sky-50 text-sm font-semibold text-sky-800 transition active:scale-[0.98]">
              <Icon name="globe" size={16} />
              {world ? `A mostrar bebidas de todo o mundo · só ${countryName ?? 'do meu país'}` : `${countryName ? `Bebidas de ${countryName} e de todo o lado` : 'Bebidas do teu país'} · ver de outros países (${hiddenForeign})`}
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 px-3 pb-32 pt-2">
        {!items && (
          <div className="space-y-2" role="status" aria-label="A carregar">{[0, 1, 2, 3, 4, 5].map((n) => <div key={n} className="skel h-[68px] rounded-2xl" />)}</div>
        )}
        {items && sections.map((s) => (
          <section key={s.slug} aria-label={s.label} className="mb-4">
            <h2 className="px-1 pb-1 pt-2 text-xs font-bold uppercase tracking-wider text-zinc-500">{s.label}</h2>
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200">
              {s.rows.map((i) => {
                const expanded = open === i.id && i.mine;
                return (
                  <li key={i.id} className={i.mine ? 'bg-sky-50/50' : 'bg-white'}>
                    <div className="flex min-h-[68px] items-center gap-3 px-3">
                      <button onClick={() => (i.mine ? setOpen(expanded ? null : i.id) : toggle(i))} aria-expanded={i.mine ? expanded : undefined} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left active:opacity-70">
                        <TasteBubble item={i} size={46} className={i.mine ? '' : 'opacity-70 saturate-50'} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 text-[16px] font-semibold leading-tight"><span className="truncate">{i.name}</span>{i.favorite && <Icon name="heart" size={14} className="shrink-0 fill-brand text-brand" aria-label="Favorito" role="img" aria-hidden={false} />}</span>
                          <span className="block truncate text-[13px] text-zinc-500">
                            {i.pending ? 'À espera de aprovação' : i.mine ? (i.rating ? ICE[i.rating] : 'Dá-lhe gelo') : others(i) > 0 ? `${fmt(others(i))} na geleira da malta` : 'Ninguém tem ainda. Sê o primeiro'}
                          </span>
                        </span>
                      </button>
                      <button onClick={() => toggle(i)} aria-pressed={i.mine} aria-label={i.mine ? `Tirar ${i.name}` : `Juntar ${i.name}`} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${i.mine ? 'bg-brand text-white' : 'border border-zinc-300 text-zinc-600'}`}>
                        <Icon name={i.mine ? 'check' : 'plus'} size={20} />
                      </button>
                    </div>
                    <div className={`grid transition-all duration-200 motion-reduce:transition-none ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                      <div className="overflow-hidden">
                        <div className="px-3 pb-3">
                          <div className="flex items-center justify-between">
                            <IceRating value={i.rating} onChange={(rating) => change(i, { rating })} size={30} />
                            <button onClick={() => change(i, { favorite: !i.favorite })} aria-pressed={i.favorite} aria-label="Favorito" className={`flex h-11 w-11 items-center justify-center rounded-full transition active:scale-90 ${i.favorite ? 'bg-rose-50 text-brand' : 'bg-zinc-100 text-zinc-600'}`}><Icon name="heart" size={20} className={i.favorite ? 'fill-brand' : ''} /></button>
                          </div>
                          <div className="mt-1 flex items-center gap-2" role="radiogroup" aria-label="Quem vê">
                            <Icon name="eye" size={16} className="shrink-0 text-zinc-500" />
                            {VIS.map((o) => (
                              <button key={o.v} role="radio" aria-checked={i.visibility === o.v} onClick={() => change(i, { visibility: o.v })} className={`h-9 flex-1 rounded-full text-[13px] font-semibold ${i.visibility === o.v ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200'}`}>{o.label}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {items && sections.length === 0 && <p className="py-10 text-center text-zinc-600">Nada com esse nome em {KIND_LABEL[kind].toLowerCase()}.</p>}

        {items && q.length >= 2 && !exact && (
          <div className="mt-2 rounded-2xl border border-dashed border-zinc-300 p-4">
            {!suggesting ? (
              <button onClick={() => setSuggesting(true)} className="flex w-full items-center gap-3 text-left active:opacity-70">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100"><Icon name="sparkles" size={22} /></span>
                <span><span className="block font-semibold">Não está cá? Sugere “{text.trim()}”</span><span className="text-sm text-zinc-500">Entra já na tua geleira; a malta vê depois de aprovado.</span></span>
              </button>
            ) : (
              <>
                <p className="font-semibold">Em que grupo fica “{text.trim()}”?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {groups.map((g) => (
                    <button key={g.slug} disabled={create.isPending} onClick={() => create.mutate({ name: text.trim(), category: g.slug })} className="h-10 rounded-full bg-zinc-900 px-4 text-sm font-semibold text-white active:scale-95 disabled:opacity-50">{g.label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-1/2 z-20 w-full max-w-xl -translate-x-1/2 border-t border-zinc-100 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm leading-tight text-zinc-600">
            <b className="text-zinc-900">{mine.length}</b> {mine.length === 1 ? 'gosto' : 'gostos'}
          </p>
          <button onClick={save} disabled={changes.length === 0 || saving} className="h-12 rounded-full bg-brand px-6 font-bold text-white transition active:scale-95 disabled:bg-brand/40">
            {saving ? 'A guardar…' : changes.length > 0 ? `Guardar (${changes.length})` : 'Guardar'}
          </button>
        </div>
      </div>
      {leaving && (
        <Sheet title="Sair sem guardar?" onClose={() => setLeaving(false)}>
          <p className="mb-4 text-zinc-600">Tens {changes.length} {changes.length === 1 ? 'mudança' : 'mudanças'} na geleira que ainda não guardaste.</p>
          <button onClick={() => { setLeaving(false); void save(); }} className="h-12 w-full rounded-full bg-brand font-bold text-white active:scale-[0.98]">Guardar e sair</button>
          <button onClick={leave} className="mt-2 h-12 w-full rounded-full font-semibold text-red-700 active:bg-red-50">Sair sem guardar</button>
          <button onClick={() => setLeaving(false)} className="mt-1 h-12 w-full rounded-full font-semibold text-zinc-700 active:bg-zinc-100">Continuar a editar</button>
        </Sheet>
      )}
      {toast && <div role="status" className="fixed bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg">{toast}</div>}
    </div>
  );
}
