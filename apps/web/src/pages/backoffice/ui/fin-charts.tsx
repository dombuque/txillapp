import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { day, fmt, pct, share, Status, type Tone } from './fin-ui';

/**
 * Gráficos simples em SVG e CSS (sem bibliotecas): linhas por dia com régua e dica ao passar, barras horizontais,
 * funil, medidor e barra repartida. Cores categóricas por ordem fixa (validadas para daltonismo); texto sempre a cinzento.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Escala "bonita" para o eixo: 0, passo, 2×passo… até cobrir o máximo. */
function niceMax(max: number) {
  if (max <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s * 4 >= max) ?? 10 * p;
  return step * 4;
}
const tick = (v: number) => (v >= 10_000 ? v.toLocaleString('pt-PT', { notation: 'compact', maximumFractionDigits: 1 }) : v.toLocaleString('pt-PT'));

export interface Series { label: string; values: number[]; color?: string }

/** Linhas por dia (um eixo só). Passa o rato ou toca para ver o dia; há sempre a tabela com os mesmos números. */
export function LineChart({ title, days, series, height = 200, unit = '', area = false, footer }: { title: string; days: string[]; series: Series[]; height?: number; unit?: string; area?: boolean; footer?: ReactNode }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const P = { t: 12, r: 8, b: 22, l: 40 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i: number) => P.l + (days.length <= 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (v: number) => P.t + ih - (v / max) * ih;
  const shown = hover ?? days.length - 1;
  const color = (s: Series, i: number) => s.color ?? SERIES[i % SERIES.length];
  const total = (s: Series) => s.values.reduce((a, b) => a + b, 0);
  const pick = (clientX: number, rect: DOMRect) => {
    const rel = clientX - rect.left - P.l;
    setHover(Math.min(days.length - 1, Math.max(0, Math.round((rel / iw) * (days.length - 1)))));
  };
  const xi = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {title ? <span className="font-bold text-zinc-900">{title}</span> : <span />}
        <span className="text-xs text-zinc-500">{days[shown] ? day(days[shown]) : ''}</span>
      </figcaption>
      {/* Legenda: sempre presente com 2 ou mais séries, com o valor do dia em foco. */}
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
          {series.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(s, i) }} aria-hidden />
              {s.label} <b className="tabular-nums text-zinc-900">{fmt(s.values[shown] ?? 0)}{unit}</b>
            </li>
          ))}
        </ul>
      )}
      {series.length === 1 && <p className="mb-1 text-sm text-zinc-600"><b className="text-lg tabular-nums text-zinc-900">{fmt(series[0].values[shown] ?? 0)}{unit}</b> neste dia · {fmt(total(series[0]))}{unit} no período</p>}
      <div ref={ref} className="relative w-full" style={{ height: H }}>
        <svg width={W} height={H} role="img" aria-label={`${title}: ${series.map((s) => `${s.label} ${total(s)}`).join(', ')}`} className="absolute inset-0 block touch-pan-y select-none"
          onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => pick(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())} onTouchMove={(e) => pick(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? '#d4d4d8' : '#f1f1f3'} />
              {(f === 0 || f === 0.5 || f === 1) && <text x={P.l - 6} y={y(max * f) + 3} fontSize="10" textAnchor="end" fill="#71717a">{tick(max * f)}</text>}
            </g>
          ))}
          {xi.map((i) => <text key={i} x={x(i)} y={H - 6} fontSize="10" fill="#71717a" textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}>{days[i] ? day(days[i]) : ''}</text>)}
          {series.map((s, si) => {
            const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
            return (
              <g key={s.label}>
                {area && si === 0 && <polygon points={`${x(0)},${y(0)} ${pts} ${x(s.values.length - 1)},${y(0)}`} fill={color(s, si)} opacity={0.1} />}
                <polyline points={pts} fill="none" stroke={color(s, si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {hover !== null && <line x1={x(shown)} x2={x(shown)} y1={P.t} y2={P.t + ih} stroke="#a1a1aa" strokeDasharray="3 3" />}
          {series.map((s, si) => <circle key={s.label} cx={x(shown)} cy={y(s.values[shown] ?? 0)} r={4} fill={color(s, si)} stroke="#fff" strokeWidth={2} />)}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-1 z-10 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs text-white shadow-lg" style={{ left: Math.min(Math.max(x(shown) - 70, 0), W - 150), minWidth: 140 }}>
            <p className="font-semibold">{day(days[shown])}</p>
            {series.map((s, si) => (
              <p key={s.label} className="flex items-center gap-1.5 tabular-nums"><span className="h-2 w-2 rounded-sm" style={{ background: color(s, si) }} />{s.label}: <b>{fmt(s.values[shown] ?? 0)}{unit}</b></p>
            ))}
          </div>
        )}
      </div>
      {footer}
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-xs text-zinc-500 underline">Ver tabela</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead><tr><th className="py-1 font-semibold">Dia</th>{series.map((s) => <th key={s.label} className="py-1 text-right font-semibold">{s.label}</th>)}</tr></thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d} className="border-t border-zinc-100"><td className="py-1">{day(d)}</td>{series.map((s) => <td key={s.label} className="py-1 text-right tabular-nums">{fmt(s.values[i] ?? 0)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Barras horizontais (um valor por linha, uma cor). */
export function HBars({ rows, color = SERIES[0], unit = '', format = fmt }: { rows: { label: ReactNode; value: number; hint?: ReactNode; to?: string; key?: string }[]; color?: string; unit?: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => {
        const label = r.to ? <Link to={r.to} className="font-medium text-zinc-800 hover:underline">{r.label}</Link> : <span className="font-medium text-zinc-800">{r.label}</span>;
        return (
          <li key={r.key ?? i}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{label}{r.hint && <span className="ml-2 text-xs text-zinc-500">{r.hint}</span>}</span>
              <span className="shrink-0 font-semibold tabular-nums text-zinc-900">{format(r.value)}{unit}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-zinc-100">
              <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 4 : 0, background: color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Funil: cada passo em relação ao primeiro, e a passagem do passo anterior. */
export function Funnel({ steps, color = SERIES[0] }: { steps: { label: string; value: number; help?: string }[]; color?: string }) {
  const base = steps[0]?.value ?? 0;
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const of = share(s.value, base);
        const prev = i > 0 ? share(s.value, steps[i - 1].value) : null;
        return (
          <li key={s.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-medium text-zinc-800">{i + 1}. {s.label}{s.help && <span className="ml-1.5 text-xs font-normal text-zinc-500">{s.help}</span>}</span>
              <span className="tabular-nums text-zinc-600"><b className="text-zinc-900">{fmt(s.value)}</b> · {pct(of)}{prev !== null && <span className="ml-2 text-xs text-zinc-400">({pct(prev)} do passo anterior)</span>}</span>
            </div>
            <div className="mt-1 h-3 rounded bg-zinc-100">
              <div className="h-full rounded" style={{ width: `${base ? (s.value / base) * 100 : 0}%`, minWidth: s.value > 0 ? 4 : 0, background: color, opacity: 1 - i * 0.1 }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Medidor (por exemplo, orçamento usado). Verde até 70%, âmbar até 90%, vermelho a partir daí; sempre com texto. */
export function Meter({ value, max, label, hint }: { value: number; max: number; label: string; hint?: ReactNode }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone: Tone = p >= 90 ? 'bad' : p >= 70 ? 'warn' : 'good';
  const bar = tone === 'bad' ? '#dc2626' : tone === 'warn' ? '#d97706' : '#059669';
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        <Status tone={tone}>{pct(Math.round(p * 10) / 10)} {tone === 'good' ? 'com folga' : tone === 'warn' ? 'a apertar' : 'quase no fim'}</Status>
      </div>
      <div className="mt-2 h-3 rounded-full bg-zinc-100" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${p}%`, minWidth: value > 0 ? 4 : 0, background: bar }} />
      </div>
      {hint && <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Uma barra repartida (partes de um todo) com legenda e valores. */
export function SplitBar({ parts }: { parts: { label: string; value: number; color?: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-md bg-zinc-100">
        {parts.filter((p) => p.value > 0).map((p) => {
          const i = parts.indexOf(p);
          return <div key={p.label} title={`${p.label}: ${p.value}`} style={{ flexGrow: p.value, background: p.color ?? SERIES[i % SERIES.length] }} />;
        })}
      </div>
      <ul className="mt-2 grid gap-1 text-sm">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color ?? SERIES[i % SERIES.length] }} aria-hidden />
            <span className="flex-1 text-zinc-700">{p.label}</span>
            <span className="tabular-nums font-semibold text-zinc-900">{fmt(p.value)}</span>
            <span className="w-12 text-right text-xs tabular-nums text-zinc-500">{pct(share(p.value, total))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pequena linha (tendência) para dentro de um cartão. */
export function Sparkline({ values, color = SERIES[0], width = 120, height = 32 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - (v / max) * (height - 4)}`).join(' ');
  return (
    <svg width={width} height={height} aria-hidden className="block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
