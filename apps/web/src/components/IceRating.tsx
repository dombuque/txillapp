import Icon from './Icon';
import { ICE } from '../lib/geleira';

/** Nota de 1 a 5 flocos de gelo. Tocar no mesmo outra vez tira a nota. */
export default function IceRating({ value, onChange, size = 28 }: { value: number | null; onChange?: (v: number | null) => void; size?: number }) {
  return (
    <div role={onChange ? 'radiogroup' : 'img'} aria-label={value ? `Nota ${value} de 5: ${ICE[value]}` : 'Sem nota'} className="flex">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = !!value && n <= value;
        const glyph = <Icon name="snowflake" size={size} className={on ? 'text-sky-500' : 'text-zinc-300'} />;
        return onChange ? (
          <button key={n} role="radio" aria-checked={value === n} aria-label={`${n} de 5: ${ICE[n]}`} onClick={() => onChange(value === n ? null : n)} className="flex h-11 w-11 items-center justify-center active:scale-90">
            {glyph}
          </button>
        ) : (
          <span key={n}>{glyph}</span>
        );
      })}
    </div>
  );
}
