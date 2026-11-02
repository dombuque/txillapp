import Icon, { type IconName } from '../components/Icon';

/** Stickers do Txillapp: desenhados na app (sem imagens externas); o servidor só guarda o id. */
export const STICKERS: { id: string; text: string; icon: IconName; from: string; to: string }[] = [
  { id: 'bora', text: 'BORA!', icon: 'flame', from: '#ff7a59', to: '#d6334f' },
  { id: 'fixe', text: 'TÁ FIXE', icon: 'check-circle', from: '#34d399', to: '#059669' },
  { id: 'ja-vou', text: 'JÁ VOU', icon: 'clock', from: '#60a5fa', to: '#2563eb' },
  { id: 'a-caminho', text: 'A CAMINHO', icon: 'map-pin', from: '#a78bfa', to: '#6d28d9' },
  { id: 'paga', text: 'PAGAS TU!', icon: 'gift', from: '#fbbf24', to: '#d97706' },
  { id: 'saude', text: 'SAÚDE!', icon: 'cheers', from: '#fcd34d', to: '#f59e0b' },
  { id: 'saudades', text: 'SAUDADES', icon: 'heart', from: '#fb7185', to: '#be123c' },
  { id: 'obrigado', text: 'OBRIGADO', icon: 'sparkles', from: '#f472b6', to: '#c026d3' },
  { id: 'parabens', text: 'PARABÉNS', icon: 'party', from: '#f9a8d4', to: '#db2777' },
  { id: 'ups', text: 'UPS…', icon: 'alert', from: '#fdba74', to: '#ea580c' },
  { id: 'dormir', text: 'BOA NOITE', icon: 'moon', from: '#818cf8', to: '#3730a3' },
  { id: 'fome', text: 'TÔ COM FOME', icon: 'utensils', from: '#fb923c', to: '#c2410c' },
  { id: 'festa', text: 'FESTA!', icon: 'music', from: '#c084fc', to: '#7e22ce' },
  { id: 'amor', text: 'ADORO', icon: 'heart', from: '#f87171', to: '#dc2626' },
  { id: 'rir', text: 'AHAHAH', icon: 'sun', from: '#facc15', to: '#ca8a04' },
  { id: 'ok', text: 'OK', icon: 'check', from: '#94a3b8', to: '#475569' },
];

/** O sticker desenhado (cartão arredondado em degradê, ícone grande e texto a negrito). */
export function Sticker({ id, size = 132 }: { id: string; size?: number }) {
  const s = STICKERS.find((x) => x.id === id);
  if (!s) return <span className="text-sm text-zinc-500">Sticker</span>;
  return (
    <span
      role="img"
      aria-label={`Sticker: ${s.text}`}
      className="flex flex-col items-center justify-center rounded-[26px] text-white shadow-[0_6px_16px_rgba(0,0,0,0.18)] ring-4 ring-white"
      style={{ width: size, height: size, background: `linear-gradient(145deg, ${s.from}, ${s.to})` }}
    >
      <Icon name={s.icon} size={Math.round(size * 0.42)} strokeWidth={2} />
      <span className="mt-1.5 px-2 text-center font-black leading-none tracking-wide" style={{ fontSize: Math.max(11, Math.round(size * 0.12)) }}>{s.text}</span>
    </span>
  );
}
