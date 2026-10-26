import type { Gender } from '../lib/api';

export const GENDERS: { value: Gender; label: string; emoji: string }[] = [
  { value: 'female', label: 'Feminino', emoji: '👩' },
  { value: 'male', label: 'Masculino', emoji: '👨' },
  { value: 'other', label: 'Outro', emoji: '🌈' },
  { value: 'unspecified', label: 'Prefiro não dizer', emoji: '🤐' },
];

export const genderLabel = (g: Gender) => GENDERS.find((x) => x.value === g)?.label ?? '';

/** "Como te identificas?" — escolha simples, sempre com a opção de não dizer. */
export default function GenderPicker({ value, onChange, dark = false }: { value: Gender | null | undefined; onChange: (g: Gender) => void; dark?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Como te identificas?" className="grid grid-cols-2 gap-3">
      {GENDERS.map((g) => {
        const on = value === g.value;
        return (
          <button
            key={g.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(g.value)}
            className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-3 py-3 text-center transition active:scale-95 ${
              on ? 'border-brand bg-rose-50 text-brand' : dark ? 'border-zinc-700 text-white' : 'border-zinc-200 bg-white text-zinc-800'
            }`}
          >
            <span className="text-2xl" aria-hidden>{g.emoji}</span>
            <span className="text-[15px] font-bold leading-tight">{g.label}</span>
          </button>
        );
      })}
    </div>
  );
}
