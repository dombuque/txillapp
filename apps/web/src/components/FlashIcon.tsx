import Icon from './Icon';

/** Ícone de flash: raio vazio e riscado quando está desligado, cheio quando está ligado. */
export default function FlashIcon({ on, size = 20 }: { on: boolean; size?: number }) {
  return (
    <span className="relative flex items-center justify-center">
      <Icon name="bolt" size={size} fill={on ? 'currentColor' : 'none'} />
      {!on && <span aria-hidden className="absolute h-[2px] rounded-full bg-current" style={{ width: size * 1.3, transform: 'rotate(-45deg)' }} />}
    </span>
  );
}
