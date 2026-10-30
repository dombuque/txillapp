import { ArrowLeft, Bell, Gift, House, MessageCircle, MessagesSquare, Pencil, Plus, Repeat2, Search, Star, Undo2, Wallet, type LucideProps } from 'lucide-react';

/**
 * Ícones de navegação e de ações, todos do mesmo conjunto (Lucide) com o mesmo traço. Aceitam width/height/strokeWidth
 * para os tamanhos de cada sítio. O conjunto completo está em Icon.tsx.
 */
const p = (size: number, extra: LucideProps) => ({ size, strokeWidth: 1.75, 'aria-hidden': true, ...extra });

export const HomeIcon = ({ filled, ...r }: LucideProps & { filled?: boolean }) => <House {...p(26, r)} fill={filled ? 'currentColor' : 'none'} />;
export const StarIcon = (r: LucideProps) => <Star {...p(26, r)} />;
export const WalletIcon = (r: LucideProps) => <Wallet {...p(26, r)} />;
export const MessagesIcon = (r: LucideProps) => <MessagesSquare {...p(26, r)} />;
export const PlusIcon = (r: LucideProps) => <Plus {...p(34, { strokeWidth: 2.4, ...r })} />;
export const CommentIcon = (r: LucideProps) => <MessageCircle {...p(22, r)} />;
export const GiftIcon = (r: LucideProps) => <Gift {...p(22, r)} />;
export const SearchIcon = (r: LucideProps) => <Search {...p(26, r)} />;
export const BellIcon = (r: LucideProps) => <Bell {...p(26, r)} />;
export const RepostIcon = (r: LucideProps) => <Repeat2 {...p(22, r)} />;
export const BackIcon = (r: LucideProps) => <ArrowLeft {...p(26, { strokeWidth: 2, ...r })} />;
export const PencilIcon = (r: LucideProps) => <Pencil {...p(22, r)} />;
export const UndoIcon = (r: LucideProps) => <Undo2 {...p(22, r)} />;
