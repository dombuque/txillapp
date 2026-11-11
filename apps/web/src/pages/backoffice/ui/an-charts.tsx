import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { fmt, fmtDay } from './an-kit';

/**
 * Gráficos leves das Análises (SVG e CSS, sem bibliotecas): linhas, barras horizontais, mapa de calor, tabela de coortes
 * e barra empilhada. Cores por papel: série 1 azul, série 2 laranja, série 3 verde-água (paleta validada para daltonismo);
 * magnitude num só tom de azul. Os números ficam sempre em texto (a cor nunca vai sozinha) e há tabela ou título com os valores.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'] as const;

export interface LineSeries { key: string; label: string; color?: string }

/** Linhas ao longo dos dias (ou dos dias desde o registo). Passar o rato ou tocar mostra os valores desse ponto. */
export function AnLine({ data, xKey = 'day', series, unit = '', yMax, xLabel = (x: string) => fmtDay(x), height = 180 }: {
  data: Record<string, unknown>[]; xKey?: string; series: LineSeries[]; unit?: string; yMax?: number; xLabel?: (x: string) => string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // A largura do SVG é a do cartão (em píxeis), para o texto ter sempre o mesmo tamanho no telemóvel e no ecrã largo.
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const P = { t: 12, r: 8, b: 22, l: 36 };
  const vals = data.flatMap((d) => series.map((s) => d[s.key])).filter((v): v is number => typeof v === 'number');
  const top = Math.max(1, ...vals) * 1.1;
  // Percentagens: o eixo não passa dos 100%.
  const max = yMax ?? (unit === '%' && Math.max(0, ...vals) <= 100 ? Math.min(100, top) : top);
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const x = (i: number) => P.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => P.t + ih - (v / max) * ih;
  const path = (k: string) => {
    let d = '';
    let pen = false;
    data.forEach((row, i) => {
      const v = row[k];
      if (typeof v !== 'number') {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const shown = hover ?? data.length - 1;
  const row = data[shown];
  const label = (v: unknown) => (typeof v === 'number' ? `${v.toLocaleString('pt-PT', { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 })}${unit}` : '—');
  return (
    <figure ref={box} className="min-w-0">
      <figcaption className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-zinc-600">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color ?? SERIES[i] }} aria-hidden />
            {s.label}: <b className="tabular-nums text-zinc-900">{row ? label(row[s.key]) : '—'}</b>
          </span>
        ))}
        {row && <span className="ml-auto text-xs text-zinc-500">{xLabel(String(row[xKey]))}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={series.map((s) => s.label).join(', ')} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#e4e4e7" strokeWidth={1} />
            <text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#71717a">{t.toLocaleString('pt-PT', { maximumFractionDigits: max < 10 ? 2 : 0 })}{unit}</text>
          </g>
        ))}
        {data.length > 0 && [0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontSize="11" fill="#71717a">{xLabel(String(data[i][xKey]))}</text>
        ))}
        {series.map((s, i) => <path key={s.key} d={path(s.key)} fill="none" stroke={s.color ?? SERIES[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={P.t + ih} stroke="#a1a1aa" strokeWidth={1} strokeDasharray="3 3" />}
        {hover != null && series.map((s, i) => {
          const v = data[hover]?.[s.key];
          return typeof v === 'number' ? <circle key={s.key} cx={x(hover)} cy={y(v)} r={4} fill={s.color ?? SERIES[i]} stroke="#fff" strokeWidth={2} /> : null;
        })}
        {data.map((_, i) => (
          <rect key={i} x={x(i) - iw / Math.max(1, data.length) / 2} y={P.t} width={Math.max(4, iw / Math.max(1, data.length))} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
        ))}
      </svg>
    </figure>
  );
}

/** Barras horizontais com o número escrito ao lado (rankings). */
export function AnBars({ rows, color = SERIES[0], max: maxIn }: { rows: { label: ReactNode; value: number; text?: ReactNode; hint?: ReactNode }[]; color?: string; max?: number }) {
  const max = maxIn ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-zinc-800">{r.label}</span>
            <span className="shrink-0 tabular-nums text-zinc-600">{r.text ?? fmt(r.value)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: color }} />
          </div>
          {r.hint && <p className="mt-0.5 text-xs text-zinc-500">{r.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** Mapa de calor dia da semana × hora (a semana começa na segunda). Um só tom: mais escuro = mais uso. */
export function AnHeatmap({ grid, unit = 'pessoas-hora' }: { grid: number[][]; unit?: string }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(1, ...grid.flat());
  const order = [1, 2, 3, 4, 5, 6, 0];
  const peak = (() => {
    let best = { d: 0, h: 0, v: -1 };
    grid.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { d, h, v }; }));
    return best;
  })();
  const cur = hover ? { ...hover, v: grid[hover.d][hover.h] } : peak;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm text-zinc-600">
        {hover ? '' : 'Pico: '}<b className="text-zinc-900">{DOW[cur.d]} {String(cur.h).padStart(2, '0')}h</b> · {fmt(cur.v)} {unit}
      </figcaption>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: '34px repeat(24, minmax(0, 1fr))' }} onMouseLeave={() => setHover(null)}>
          <span />
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center text-[10px] text-zinc-400">{h % 3 === 0 ? h : ''}</span>)}
          {order.map((d) => (
            <div key={d} className="contents">
              <span className="pr-1 text-right text-[11px] leading-5 text-zinc-500">{DOW[d]}</span>
              {grid[d].map((v, h) => (
                <span key={h} title={`${DOW[d]} ${h}h: ${fmt(v)} ${unit}`} onMouseEnter={() => setHover({ d, h })} onTouchStart={() => setHover({ d, h })}
                  className="h-5 rounded-[3px]" style={{ background: v === 0 ? '#f4f4f5' : `rgba(42,120,214,${0.12 + 0.88 * (v / max)})` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
        menos <span className="h-2 w-24 rounded" style={{ background: 'linear-gradient(90deg, rgba(42,120,214,0.12), rgba(42,120,214,1))' }} aria-hidden /> mais
      </div>
    </figure>
  );
}

/** Uma barra 100% em partes (ex.: quem cria / interage / só vê), com legenda e valores escritos. */
export function AnStack({ parts }: { parts: { label: string; pct: number | null; color?: string }[] }) {
  const id = useId();
  return (
    <div>
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-md" aria-labelledby={id}>
        {parts.map((p, i) => (p.pct ? <div key={i} style={{ width: `${p.pct}%`, background: p.color ?? SERIES[i] }} title={`${p.label}: ${p.pct}%`} /> : null))}
      </div>
      <ul id={id} className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {parts.map((p, i) => (
          <li key={i} className="inline-flex items-center gap-1.5 text-zinc-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color ?? SERIES[i] }} aria-hidden />
            {p.label}: <b className="tabular-nums text-zinc-900">{p.pct == null ? '—' : `${p.pct.toLocaleString('pt-PT')}%`}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Célula de percentagem com fundo azul proporcional (tabela de coortes). */
export function PctCell({ v, max = 100 }: { v: number | null | 'small'; max?: number }) {
  if (v === 'small') return <span className="block rounded bg-zinc-50 px-1.5 py-1 text-center text-[11px] text-zinc-400" title="Coorte pequena: escondida">&lt;20</span>;
  if (v == null) return <span className="block px-1.5 py-1 text-center text-zinc-300">·</span>;
  const a = Math.min(1, v / max);
  return (
    <span className="block rounded px-1.5 py-1 text-center text-xs font-semibold tabular-nums" style={{ background: `rgba(42,120,214,${0.08 + 0.8 * a})`, color: a > 0.55 ? '#fff' : '#18181b' }}>
      {v.toLocaleString('pt-PT', { maximumFractionDigits: 0 })}%
    </span>
  );
}
