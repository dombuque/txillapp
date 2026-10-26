import { useState } from 'react';

interface Point {
  day: string;
  value: number;
}

const BRAND = '#d6334f';
const W = 320;
const H = 128;
const PAD = { top: 14, right: 4, bottom: 18, left: 4 };

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Barras por dia, uma série só (o título diz qual): barras finas ancoradas na base com o topo arredondado,
 * grelha discreta, só o máximo e o último valor escritos; toque numa barra para ver o dia e o valor.
 * Há sempre uma tabela com os mesmos números ("Ver tabela").
 */
export default function BarChart({ title, data, unit = '' }: { title: string; data: Point[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((a, d) => a + d.value, 0);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / data.length;
  const barW = Math.min(14, slot * 0.62);
  const last = data[data.length - 1];
  const shown = hover ?? data.length - 1;

  return (
    <figure className="rounded-2xl border border-zinc-200 bg-white p-4">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="font-bold text-zinc-900">{title}</span>
        <span className="text-sm text-zinc-600">
          <b className="text-zinc-900">{data[shown]?.value ?? 0}{unit}</b> · {data[shown] ? fmtDay(data[shown].day) : ''}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`${title}: total ${total}, último dia ${last?.value ?? 0}`} onMouseLeave={() => setHover(null)}>
        {/* grelha: só a base e a linha do máximo, em cinzento muito claro */}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="#d4d4d8" strokeWidth="1" />
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top} y2={PAD.top} stroke="#f4f4f5" strokeWidth="1" />
        <text x={PAD.left} y={PAD.top - 4} fontSize="9" fill="#71717a">{max}{unit}</text>
        {data.map((d, i) => {
          const h = d.value === 0 ? 0 : Math.max(2, (d.value / max) * innerH);
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const y = PAD.top + innerH - h;
          const r = Math.min(4, barW / 2, h);
          const active = i === shown;
          return (
            <g key={d.day}>
              {/* alvo de toque maior do que a barra */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH + PAD.bottom} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} onTouchStart={() => setHover(i)} />
              {h > 0 && (
                // topo arredondado, base reta (ancorada na linha de base)
                <path
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                  fill={BRAND}
                  opacity={active ? 1 : 0.55}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
        <text x={PAD.left} y={H - 4} fontSize="9" fill="#71717a">{data[0] ? fmtDay(data[0].day) : ''}</text>
        <text x={W - PAD.right} y={H - 4} fontSize="9" fill="#71717a" textAnchor="end">{last ? fmtDay(last.day) : ''}</text>
      </svg>
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-zinc-600 underline">Ver tabela</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr><th className="py-1 font-semibold">Dia</th><th className="py-1 text-right font-semibold">{title}</th></tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day} className="border-t border-zinc-100"><td className="py-1">{fmtDay(d.day)}</td><td className="py-1 text-right tabular-nums">{d.value}{unit}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
