import Icon from './Icon';

/** O SuperTxill (a IA do Txillapp): um círculo coral com o raio, sempre igual. */
export const BOT_USERNAME = 'supertxill';

export default function BotAvatar({ size = 52 }: { size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-[#ff9a5b] text-white shadow-sm" style={{ width: size, height: size }}>
      <Icon name="bolt" size={Math.round(size * 0.5)} fill="currentColor" />
    </span>
  );
}
