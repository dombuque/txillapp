import type { IconName } from '@/components/Icon';
import type { TasteKind } from '@/lib/api.geleira';
import { t } from '@/lib/i18n';

export const KIND_LABEL: Record<TasteKind, string> = { get vibe() { return t('Ambientes'); }, get bebida() { return t('Bebidas'); }, get comida() { return t('Comidas'); }, get sitio() { return t('Sítios'); } };
export const KIND_ICON: Record<TasteKind, IconName> = { vibe: 'sparkles', bebida: 'cheers', comida: 'utensils', sitio: 'map-pin' };
export const KINDS: TasteKind[] = ['vibe', 'bebida', 'comida', 'sitio'];

/** Grupos que se podem escolher ao sugerir um item novo, por tipo. */
export const CATEGORIES: Record<TasteKind, { slug: string; label: string }[]> = {
  vibe: [{ slug: 'calma', get label() { return t('Calma'); } }, { slug: 'ar-livre', get label() { return t('Ar livre'); } }, { slug: 'convivio', get label() { return t('Convívio'); } }, { slug: 'festa', get label() { return t('Festa'); } }, { slug: 'musica', get label() { return t('Música'); } }, { slug: 'desporto', get label() { return t('Desporto'); } }],
  bebida: [
    { slug: 'refrigerante', get label() { return t('Refrigerantes'); } }, { slug: 'energia', get label() { return t('Energéticas'); } }, { slug: 'sumo', get label() { return t('Sumos'); } }, { slug: 'cafe-cha', get label() { return t('Café e chá'); } },
    { slug: 'leite', get label() { return t('Leite e batidos'); } }, { slug: 'agua', get label() { return t('Água'); } }, { slug: 'cerveja', get label() { return t('Cervejas'); } }, { slug: 'tradicional', get label() { return t('Tradicionais'); } },
    { slug: 'vinho', get label() { return t('Vinhos'); } }, { slug: 'destilado', get label() { return t('Destilados'); } }, { slug: 'cocktail', get label() { return t('Cocktails'); } },
  ],
  comida: [{ slug: 'prato-tipico', get label() { return t('Prato típico'); } }, { slug: 'rua', get label() { return t('De rua'); } }, { slug: 'marisco', get label() { return t('Marisco'); } }, { slug: 'grelhados', get label() { return t('Grelhados'); } }, { slug: 'doce', get label() { return t('Doces'); } }, { slug: 'petisco', get label() { return t('Petiscos'); } }],
  sitio: [{ slug: 'noite', get label() { return t('Noite'); } }, { slug: 'comer-beber', get label() { return t('Comer e beber'); } }, { slug: 'ar-livre', get label() { return t('Ar livre'); } }, { slug: 'dia-a-dia', get label() { return t('Dia a dia'); } }],
};

/** Escala de gelo: de morno a gelada de rachar. */
export const ICE = () => ['', t('Morno'), t('Fresquinho'), t('Fresco'), t('Gelado'), t('Gelada de rachar')];
