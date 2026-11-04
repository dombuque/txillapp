import type { IconName } from '../components/Icon';
import { locale, tr } from './i18n';
import type { TasteKind } from './api';

export const KIND_LABEL: Record<TasteKind, string> = { vibe: tr('Vibes'), bebida: tr('Bebidas'), comida: tr('Comidas'), sitio: tr('Sítios') };
export const KIND_ICON: Record<TasteKind, IconName> = { vibe: 'sparkles', bebida: 'cheers', comida: 'utensils', sitio: 'map-pin' };
export const KINDS: TasteKind[] = ['vibe', 'bebida', 'comida', 'sitio'];

/** Grupos que se podem escolher ao sugerir um item novo, por tipo. */
export const CATEGORIES: Record<TasteKind, { slug: string; label: string }[]> = {
  vibe: [{ slug: 'calma', label: tr('Calma') }, { slug: 'ar-livre', label: tr('Ar livre') }, { slug: 'convivio', label: tr('Convívio') }, { slug: 'festa', label: tr('Festa') }, { slug: 'musica', label: tr('Música') }, { slug: 'desporto', label: tr('Desporto') }],
  bebida: [
    { slug: 'refrigerante', label: tr('Refrigerantes') }, { slug: 'energia', label: tr('Energéticas') }, { slug: 'sumo', label: tr('Sumos') }, { slug: 'cafe-cha', label: tr('Café e chá') },
    { slug: 'leite', label: tr('Leite e batidos') }, { slug: 'agua', label: tr('Água') }, { slug: 'cerveja', label: tr('Cervejas') }, { slug: 'tradicional', label: tr('Tradicionais') },
    { slug: 'vinho', label: tr('Vinhos') }, { slug: 'destilado', label: tr('Destilados') }, { slug: 'cocktail', label: tr('Cocktails') },
  ],
  comida: [{ slug: 'prato-tipico', label: tr('Prato típico') }, { slug: 'rua', label: tr('De rua') }, { slug: 'marisco', label: tr('Marisco') }, { slug: 'grelhados', label: tr('Grelhados') }, { slug: 'doce', label: tr('Doces') }, { slug: 'petisco', label: tr('Petiscos') }],
  sitio: [{ slug: 'noite', label: tr('Noite') }, { slug: 'comer-beber', label: tr('Comer e beber') }, { slug: 'ar-livre', label: tr('Ar livre') }, { slug: 'dia-a-dia', label: tr('Dia a dia') }],
};

/** Escala de gelo: de morno a gelada de rachar. */
export const ICE = locale.startsWith('en') ? ['', 'Lukewarm', 'Cool', 'Fresh', 'Cold', 'Ice cold'] : ['', 'Morno', 'Fresquinho', 'Fresco', 'Gelado', 'Gelada de rachar'];
