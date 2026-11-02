import type { IconName } from '../components/Icon';
import type { TasteItem, TasteKind } from './api';

export const KIND_LABEL: Record<TasteKind, string> = { vibe: 'Vibes', bebida: 'Bebidas', comida: 'Comidas', sitio: 'Sítios' };
export const KIND_ICON: Record<TasteKind, IconName> = { vibe: 'sparkles', bebida: 'cheers', comida: 'utensils', sitio: 'map-pin' };
export const KINDS: TasteKind[] = ['vibe', 'bebida', 'comida', 'sitio'];

/** Grupos que se podem escolher ao sugerir um item novo, por tipo. */
export const CATEGORIES: Record<TasteKind, { slug: string; label: string }[]> = {
  vibe: [{ slug: 'calma', label: 'Calma' }, { slug: 'ar-livre', label: 'Ar livre' }, { slug: 'convivio', label: 'Convívio' }, { slug: 'festa', label: 'Festa' }, { slug: 'musica', label: 'Música' }, { slug: 'desporto', label: 'Desporto' }],
  bebida: [{ slug: 'refrigerante', label: 'Refrigerante' }, { slug: 'sumo', label: 'Sumo' }, { slug: 'cafe-cha', label: 'Café e chá' }, { slug: 'cerveja', label: 'Cerveja' }, { slug: 'vinho', label: 'Vinho' }, { slug: 'destilado', label: 'Destilado' }],
  comida: [{ slug: 'prato-tipico', label: 'Prato típico' }, { slug: 'rua', label: 'De rua' }, { slug: 'marisco', label: 'Marisco' }, { slug: 'grelhados', label: 'Grelhados' }, { slug: 'doce', label: 'Doces' }, { slug: 'petisco', label: 'Petiscos' }],
  sitio: [{ slug: 'noite', label: 'Noite' }, { slug: 'comer-beber', label: 'Comer e beber' }, { slug: 'ar-livre', label: 'Ar livre' }, { slug: 'dia-a-dia', label: 'Dia a dia' }],
};

const BY_CATEGORY: Record<string, IconName> = {
  calma: 'sofa', 'ar-livre': 'sun', convivio: 'users', festa: 'party', musica: 'music', desporto: 'dumbbell', rotina: 'moon',
  refrigerante: 'soda', sumo: 'water', 'cafe-cha': 'coffee', cerveja: 'beer', vinho: 'cheers', destilado: 'martini', tradicional: 'beer',
  'prato-tipico': 'soup', rua: 'sandwich', marisco: 'fish', grelhados: 'flame', doce: 'ice-cream', petisco: 'cake', internacional: 'utensils',
  noite: 'moon', 'comer-beber': 'utensils', 'dia-a-dia': 'store',
};
export const iconOf = (i: Pick<TasteItem, 'kind' | 'category'>): IconName => BY_CATEGORY[i.category] ?? KIND_ICON[i.kind];

/** Escala de gelo: de morno a gelada de rachar. */
export const ICE = ['', 'Morno', 'Fresquinho', 'Fresco', 'Gelado', 'Gelada de rachar'];
