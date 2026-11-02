import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { KINDS, KIND_ICON, KIND_LABEL } from '../lib/geleira';
import Icon from './Icon';

/** A geleira na carteira: vale Txills. É valor de estatuto (não é saldo): sobe com o gelo, os favoritos e o que é raro. */
export default function GeleiraWallet() {
  const q = useQuery({ queryKey: ['geleira', 'value'], queryFn: api.geleiraValue, staleTime: 30_000 });
  const v = q.data;
  if (!v) return q.isLoading ? <div className="skel mt-6 h-40 rounded-[28px]" role="status" aria-label="A carregar a geleira" /> : null;

  const empty = v.total === 0;
  const span = v.level.next ? v.level.next.at - v.level.from : 0;
  const pct = v.level.next ? Math.min(100, Math.round(((v.total - v.level.from) / span) * 100)) : 100;

  return (
    <section className="mt-6 overflow-hidden rounded-[28px] bg-gradient-to-br from-sky-600 to-cyan-500 p-6 text-white shadow-[0_10px_30px_rgba(2,132,199,0.3)]" aria-label="A minha geleira">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 font-light"><Icon name="snowflake" size={18} /> A tua geleira vale</p>
          <p className="text-5xl font-extrabold tracking-tight">{v.total.toLocaleString('pt-PT')} <span className="text-2xl font-bold">TXL</span></p>
        </div>
        <span className="mt-1 shrink-0 rounded-full bg-white/20 px-3 py-1 text-sm font-bold">{v.level.name}</span>
      </div>

      {empty ? (
        <p className="mt-3 text-white/90">Geleira vazia vale zero. Mete vibes, bebidas, comidas e sítios, dá-lhes gelo, e começa a render.</p>
      ) : (
        <>
          <div className="mt-4">
            <div className="h-2.5 overflow-hidden rounded-full bg-white/25" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Caminho para o próximo nível">
              <div className="h-full rounded-full bg-white transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-sm text-white/90">
              {v.level.next ? <>Faltam <b>{(v.level.next.at - v.total).toLocaleString('pt-PT')} TXL</b> para <b>{v.level.next.name}</b></> : 'Chegaste ao topo. Lenda!'}
            </p>
          </div>

          <ul className="mt-4 grid grid-cols-2 gap-2" aria-label="Valor por prateleira">
            {KINDS.map((k) => (
              <li key={k} className="flex items-center gap-2 rounded-2xl bg-white/15 px-3 py-2">
                <Icon name={KIND_ICON[k]} size={18} className="shrink-0" />
                <span className="min-w-0 text-sm leading-tight"><span className="block truncate font-semibold">{KIND_LABEL[k]}</span><span className="text-white/85">{v.byKind[k].value.toLocaleString('pt-PT')} TXL · {v.byKind[k].count}</span></span>
              </li>
            ))}
          </ul>
          {v.bonusPct > 0 && <p className="mt-2 text-sm text-white/90">Prateleiras cheias: <b>+{v.bonusPct}%</b> no total</p>}

          {v.jewels.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-sm font-bold uppercase tracking-wide text-white/85">As joias da geleira</p>
              <ol className="space-y-1.5">
                {v.jewels.map((j, n) => (
                  <li key={j.name} className="flex items-center justify-between rounded-2xl bg-white/15 px-3 py-2">
                    <span className="truncate font-semibold">{n + 1}. {j.name}</span>
                    <span className="ml-3 shrink-0 font-extrabold">{j.value.toLocaleString('pt-PT')}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      <Link to="/profile" className="mt-4 flex h-12 items-center justify-center gap-2 rounded-full bg-white font-bold text-sky-700 transition active:scale-[0.98]">
        <Icon name="plus" size={18} /> {empty ? 'Encher a geleira' : 'Valorizar a geleira'}
      </Link>
      <p className="mt-3 text-center text-xs text-white/80">Valor de estatuto: não é saldo e não se gasta. Quanto mais gelo, favoritos e coisas raras, mais vale. Só tu o vês.</p>
    </section>
  );
}
