import type { Gender } from '../lib/api';
import { tr } from '../lib/i18n';

export const GENDERS: { value: Gender; label: string }[] = [
  { value: 'female', label: tr('Feminino') },
  { value: 'male', label: tr('Masculino') },
];

/** Contas antigas podem ter outro valor guardado: continua a mostrar-se, mas já não se oferece a quem escolhe. */
const LEGACY: Partial<Record<Gender, string>> = { other: 'Outro', unspecified: 'Prefiro não dizer' };

export const genderLabel = (g: Gender) => GENDERS.find((x) => x.value === g)?.label ?? (LEGACY[g] ? tr(LEGACY[g]!) : '');

/** "Como te identificas?" — Feminino ou Masculino. */
export default function GenderPicker({ value, onChange, dark = false }: { value: Gender | null | undefined; onChange: (g: Gender) => void; dark?: boolean }) {
  return (
    <div role="radiogroup" aria-label={tr('Como te identificas?')} className="grid grid-cols-2 gap-3">
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
            <span className="text-[15px] font-bold leading-tight">{g.label}</span>
          </button>
        );
      })}
    </div>
  );
}
