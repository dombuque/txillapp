import Icon, { type IconProps } from './Icon';

/**
 * Atalhos dos ícones de navegação e de ações, com o tamanho com que cada um se usa. O conjunto completo está em Icon.tsx
 * (a biblioteca "Tx"). `filled` mostra a versão cheia (separador ativo).
 */
type P = Omit<IconProps, 'name' | 'solid'> & { filled?: boolean };
const make = (name: IconProps['name'], size: number, extra: Partial<IconProps> = {}) =>
  function TxShortcut({ filled, ...r }: P) {
    return <Icon name={name} size={size} solid={filled} {...extra} {...r} />;
  };

export const HomeIcon = make('home', 26);
export const StarIcon = make('star', 26);
export const WalletIcon = make('wallet', 26);
export const MessagesIcon = make('messages', 26);
export const PlusIcon = make('square-plus', 34, { strokeWidth: 2.1 });
export const CommentIcon = make('comment', 22);
export const GiftIcon = make('present', 22);
export const SearchIcon = make('search', 26);
export const BellIcon = make('bell', 26);
export const RepostIcon = make('repeat', 22);
export const BackIcon = make('back', 26, { strokeWidth: 2 });
export const PencilIcon = make('pencil', 22);
export const UndoIcon = make('undo', 22);
