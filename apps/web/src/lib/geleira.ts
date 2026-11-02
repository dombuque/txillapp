import type { IconName } from '../components/Icon';
import type { TasteKind } from './api';

export const KIND_LABEL: Record<TasteKind, string> = { vibe: 'Vibes', bebida: 'Bebidas', comida: 'Comidas', sitio: 'Sítios' };
export const KIND_ICON: Record<TasteKind, IconName> = { vibe: 'sparkles', bebida: 'cheers', comida: 'utensils', sitio: 'map-pin' };
export const KINDS: TasteKind[] = ['vibe', 'bebida', 'comida', 'sitio'];

/** Grupos que se podem escolher ao sugerir um item novo, por tipo. */
export const CATEGORIES: Record<TasteKind, { slug: string; label: string }[]> = {
  vibe: [{ slug: 'calma', label: 'Calma' }, { slug: 'ar-livre', label: 'Ar livre' }, { slug: 'convivio', label: 'Convívio' }, { slug: 'festa', label: 'Festa' }, { slug: 'musica', label: 'Música' }, { slug: 'desporto', label: 'Desporto' }],
  bebida: [
    { slug: 'refrigerante', label: 'Refrigerantes' }, { slug: 'energia', label: 'Energéticas' }, { slug: 'sumo', label: 'Sumos' }, { slug: 'cafe-cha', label: 'Café e chá' },
    { slug: 'leite', label: 'Leite e batidos' }, { slug: 'agua', label: 'Água' }, { slug: 'cerveja', label: 'Cervejas' }, { slug: 'tradicional', label: 'Tradicionais' },
    { slug: 'vinho', label: 'Vinhos' }, { slug: 'destilado', label: 'Destilados' }, { slug: 'cocktail', label: 'Cocktails' },
  ],
  comida: [{ slug: 'prato-tipico', label: 'Prato típico' }, { slug: 'rua', label: 'De rua' }, { slug: 'marisco', label: 'Marisco' }, { slug: 'grelhados', label: 'Grelhados' }, { slug: 'doce', label: 'Doces' }, { slug: 'petisco', label: 'Petiscos' }],
  sitio: [{ slug: 'noite', label: 'Noite' }, { slug: 'comer-beber', label: 'Comer e beber' }, { slug: 'ar-livre', label: 'Ar livre' }, { slug: 'dia-a-dia', label: 'Dia a dia' }],
};

/** Escala de gelo: de morno a gelada de rachar. */
export const ICE = ['', 'Morno', 'Fresquinho', 'Fresco', 'Gelado', 'Gelada de rachar'];
