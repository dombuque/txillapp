import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Icon from '../../components/Icon';
import { Badge, Empty, PageHeader, ago, btnGhost, btnPrimary, td, th, useCan } from './bo';
import { modApi, type CatalogItem } from './ui/mod-api';
import { DecideDialog, Field, Segmented, inputCls, selectCls, useDebounced, useToast } from './ui/mod-kit';

const KIND: Record<CatalogItem['kind'], string> = { vibe: 'Vibe', bebida: 'Bebida', comida: 'Comida', sitio: 'Sítio' };
const KINDS = Object.keys(KIND) as CatalogItem['kind'][];
type Status = 'pending' | 'curated' | 'rejected';

/** Criar ou editar um item: nome, tipo, grupo, álcool, países e o motivo (fica no registo). */
function ItemDialog({ item, categories, onClose, onSaved }: { item: CatalogItem | null; categories: { kind: string; category: string }[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<CatalogItem['kind']>(item?.kind ?? 'bebida');
  const [category, setCategory] = useState(item?.category ?? '');
  const [alcoholic, setAlcoholic] = useState(item?.alcoholic ?? false);
  const [countries, setCountries] = useState((item?.countries ?? []).join(', '));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const list = countries.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
  const badCountry = list.find((c) => !/^[A-Z]{2}$/.test(c));
  async function save() {
    setBusy(true);
    setErr('');
    try {
      const b = { name: name.trim(), kind, category: category.trim(), alcoholic: kind === 'bebida' && alcoholic, countries: list.length ? list : null, reason: reason.trim() };
      if (item) await modApi.catalogEdit(item.id, b);
      else await modApi.catalogCreate(b);
      onSaved(item ? 'Item atualizado' : 'Item criado e aprovado');
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label={item ? 'Editar item' : 'Novo item'} data-mod-dialog className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{item ? `Editar «${item.name}»` : 'Novo item do catálogo'}</h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Nome" className="col-span-2"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={inputCls} /></Field>
          <Field label="Tipo">
            <select value={kind} onChange={(e) => setKind(e.target.value as CatalogItem['kind'])} className={`${selectCls} w-full`}>{KINDS.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select>
          </Field>
          <Field label="Grupo">
            <input value={category} onChange={(e) => setCategory(e.target.value.toLowerCase())} list="cat-groups" placeholder="ex.: cerveja" className={inputCls} />
            <datalist id="cat-groups">{categories.filter((c) => c.kind === kind).map((c) => <option key={c.category} value={c.category} />)}</datalist>
          </Field>
          <Field label="Países (vazio = todos)" className="col-span-2"><input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="MZ, PT, AO" className={inputCls} /></Field>
          {kind === 'bebida' && (
            <label className="col-span-2 flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={alcoholic} onChange={(e) => setAlcoholic(e.target.checked)} className="h-4 w-4 accent-zinc-900" /> Bebida alcoólica (não aparece a menores de 18)
            </label>
          )}
          <Field label="Motivo (fica no registo)" className="col-span-2"><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} className="w-full rounded-lg border border-zinc-300 p-2.5 text-sm outline-none focus:border-zinc-900" /></Field>
        </div>
        {badCountry && <p className="mt-2 text-sm text-red-600">«{badCountry}» não é um código de país de duas letras.</p>}
        {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancelar</button>
          <button type="button" disabled={busy || name.trim().length < 2 || category.trim().length < 2 || reason.trim().length < 3 || !!badCountry} onClick={() => void save()} className={btnPrimary}>{busy ? 'A guardar…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}

/** O catálogo da Geleira: aprovar ou rejeitar o que a malta sugere, editar itens, e dizer em que países cada um faz sentido. */
export default function BackofficeCatalog() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan('catalog.manage');
  const [status, setStatus] = useState<Status>('pending');
  const [kind, setKind] = useState<'' | CatalogItem['kind']>('');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const [country, setCountry] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<CatalogItem | null | 'new'>(null);
  const [deciding, setDeciding] = useState<{ ids: string[]; approve: boolean } | null>(null);

  const list = useQuery({ queryKey: ['mod-catalog', status, kind, q, country], queryFn: () => modApi.catalog({ status, kind: kind || undefined, q: q || undefined, country: country || undefined }) });
  const items = list.data?.items ?? [];
  const counts = list.data?.counts ?? {};
  const refresh = () => { setChecked(new Set()); void qc.invalidateQueries({ queryKey: ['mod-catalog'] }); };
  const toggle = (id: string, v: boolean) => setChecked((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });

  return (
    <>
      <PageHeader
        title="Catálogo da Geleira"
        description="O que a malta pode pôr na geleira: vibes, bebidas, comidas e sítios. As sugestões só aparecem a quem as fez até serem aprovadas."
        actions={can ? <button type="button" onClick={() => setEditing('new')} className={btnPrimary}><Icon name="plus" size={16} className="mr-1.5" />Novo item</button> : undefined}
      />
      <div role="tablist" aria-label="Estado" className="mb-4 flex flex-wrap gap-2">
        {([['pending', 'Sugestões por aprovar'], ['curated', 'Aprovados'], ['rejected', 'Rejeitados']] as [Status, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => { setStatus(k); setChecked(new Set()); }} className={`h-9 rounded-lg px-4 text-sm font-semibold ${status === k ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50'}`}>
            {l} {counts[k] ? <span className="opacity-70">({counts[k]})</span> : null}
          </button>
        ))}
      </div>
      <div className="mb-4 grid gap-3 rounded-2xl bg-white p-3 ring-1 ring-zinc-200/70 sm:p-4 md:grid-cols-[auto_1fr_200px] md:items-end">
        <Segmented label="Tipo" value={kind} onChange={setKind} options={[{ value: '' as const, label: 'Todos' }, ...KINDS.map((k) => ({ value: k, label: KIND[k] }))]} />
        <Field label="Procurar"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nome ou grupo" className={inputCls} /></Field>
        <Field label="País">
          <select value={country} onChange={(e) => setCountry(e.target.value)} className={`${selectCls} w-full`}>
            <option value="">Todos</option>
            <option value="global">Sem país (em todo o lado)</option>
            {list.data?.countries.map((c) => <option key={c.country} value={c.country}>{c.country} ({c.count})</option>)}
          </select>
        </Field>
      </div>

      {status === 'pending' && can && checked.size > 0 && (
        <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-sm text-white shadow-lg">
          <span className="font-semibold">{checked.size} selecionado{checked.size === 1 ? '' : 's'}</span>
          <span className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => setDeciding({ ids: [...checked], approve: true })} className="h-8 rounded-lg bg-emerald-600 px-3 font-semibold hover:bg-emerald-700">Aprovar</button>
            <button type="button" onClick={() => setDeciding({ ids: [...checked], approve: false })} className="h-8 rounded-lg bg-white/10 px-3 font-semibold hover:bg-white/20">Rejeitar</button>
          </span>
        </div>
      )}

      {list.isLoading ? <div className="h-40 animate-pulse rounded-2xl bg-white" /> : items.length === 0 ? (
        <Empty title={status === 'pending' ? 'Sem sugestões por aprovar' : 'Nada encontrado'} text={status === 'pending' ? 'Quando alguém sugerir um item novo, aparece aqui.' : undefined} />
      ) : (
        <>
          {/* Computador: tabela. */}
          <div className="hidden overflow-x-auto rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,18,25,0.06)] ring-1 ring-zinc-200/70 md:block">
            <table className="w-full">
              <thead className="border-b border-zinc-200 bg-zinc-50">
                <tr>
                  {status === 'pending' && can && <th className={`${th} w-8`}><input type="checkbox" aria-label="Selecionar todos" checked={checked.size === items.length} onChange={(e) => setChecked(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} className="h-4 w-4 accent-zinc-900" /></th>}
                  <th className={th}>Item</th><th className={th}>Tipo e grupo</th><th className={th}>Países</th><th className={th}>Na geleira de</th><th className={th}>{status === 'pending' ? 'Sugerido' : 'Criado'}</th><th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {items.map((i) => (
                  <tr key={i.id} className="hover:bg-zinc-50/60">
                    {status === 'pending' && can && <td className={td}><input type="checkbox" aria-label={`Selecionar ${i.name}`} checked={checked.has(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} className="h-4 w-4 accent-zinc-900" /></td>}
                    <td className={td}>
                      <span className="font-semibold">{i.name}</span>
                      {i.alcoholic && <span className="ml-2"><Badge tone="amber">18+</Badge></span>}
                      {i.duplicateOf && <span className="mt-0.5 block text-xs text-red-700">Já existe um item aprovado com este nome</span>}
                    </td>
                    <td className={td}><span className="text-zinc-700">{KIND[i.kind]}</span> <span className="text-zinc-400">·</span> <span className="font-mono text-xs text-zinc-600">{i.category}</span></td>
                    <td className={td}>{i.countries?.length ? <span className="flex flex-wrap gap-1">{i.countries.map((c) => <Badge key={c}>{c}</Badge>)}</span> : <span className="text-xs text-zinc-400">todos</span>}</td>
                    <td className={td}>{i.fans} {i.fans === 1 ? 'pessoa' : 'pessoas'}</td>
                    <td className={`${td} whitespace-nowrap text-xs text-zinc-500`}>{i.suggestedBy ? `@${i.suggestedBy}${i.suggestedCountry ? ` (${i.suggestedCountry})` : ''} · ` : ''}{ago(i.createdAt)}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {can && i.status === 'pending' && (
                        <>
                          <button type="button" onClick={() => setDeciding({ ids: [i.id], approve: true })} className="mr-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Aprovar</button>
                          <button type="button" onClick={() => setDeciding({ ids: [i.id], approve: false })} className="mr-1 rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-200">Rejeitar</button>
                        </>
                      )}
                      {can && <button type="button" onClick={() => setEditing(i)} className="rounded-md px-2 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-100" aria-label={`Editar ${i.name}`}><Icon name="pencil" size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Telemóvel: cartões. */}
          <ul className="space-y-2 md:hidden">
            {items.map((i) => (
              <li key={i.id} className="rounded-xl bg-white p-3 ring-1 ring-zinc-200/70">
                <div className="flex items-start gap-2">
                  {status === 'pending' && can && <input type="checkbox" aria-label={`Selecionar ${i.name}`} checked={checked.has(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} className="mt-1 h-4 w-4 accent-zinc-900" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{i.name} {i.alcoholic && <Badge tone="amber">18+</Badge>}</p>
                    <p className="text-xs text-zinc-500">{KIND[i.kind]} · {i.category} · {i.countries?.join(', ') || 'todos os países'} · {i.fans} na geleira</p>
                    {i.suggestedBy && <p className="text-xs text-zinc-500">por @{i.suggestedBy} · {ago(i.createdAt)}</p>}
                    {i.duplicateOf && <p className="text-xs text-red-700">Já existe um item aprovado com este nome</p>}
                  </div>
                </div>
                {can && (
                  <div className="mt-2 flex gap-2">
                    {i.status === 'pending' && <button type="button" onClick={() => setDeciding({ ids: [i.id], approve: true })} className="h-9 flex-1 rounded-lg bg-emerald-600 text-sm font-semibold text-white">Aprovar</button>}
                    {i.status === 'pending' && <button type="button" onClick={() => setDeciding({ ids: [i.id], approve: false })} className="h-9 flex-1 rounded-lg bg-zinc-100 text-sm font-semibold text-zinc-700">Rejeitar</button>}
                    <button type="button" onClick={() => setEditing(i)} className="h-9 flex-1 rounded-lg border border-zinc-300 text-sm font-semibold text-zinc-700">Editar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && <ItemDialog item={editing === 'new' ? null : editing} categories={list.data?.categories ?? []} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); toast.show(m); refresh(); }} />}
      {deciding && (
        <DecideDialog
          title={`${deciding.approve ? 'Aprovar' : 'Rejeitar'} ${deciding.ids.length === 1 ? 'a sugestão' : `${deciding.ids.length} sugestões`}`}
          help={deciding.approve ? 'Passa a aparecer a toda a gente no catálogo (nos países indicados).' : 'Deixa de aparecer, também a quem a sugeriu.'}
          confirm={deciding.approve ? 'Aprovar' : 'Rejeitar'}
          danger={!deciding.approve}
          reasonRequired={!deciding.approve}
          presets={deciding.approve ? [] : ['Repetido', 'Nome impróprio', 'Não é um item da geleira', 'Marca ou pessoa']}
          onCancel={() => setDeciding(null)}
          onConfirm={async (reason) => {
            const r = await modApi.catalogDecide(deciding.ids, deciding.approve, reason);
            setDeciding(null);
            toast.show(`${r.changed} ${deciding.approve ? 'aprovado' : 'rejeitado'}${r.changed === 1 ? '' : 's'}`);
            refresh();
          }}
        />
      )}
      {toast.node}
    </>
  );
}
