import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import type { TasteItem } from '@/lib/api.geleira';
import { DrinkArt } from './DrinkArt';
import { Icon, type IconName } from './Icon';

/** Um ícone Tx por item do catálogo (na app só há o conjunto Tx, por isso há menos variedade do que no site). */
const BY_SLUG: Record<string, IconName> = {
  'vibe-chill': 'sofa', 'vibe-sofa-series': 'film', 'vibe-leitura': 'file-text', 'vibe-musica-baixinho': 'music', 'vibe-pe-na-areia': 'umbrella',
  'vibe-por-do-sol': 'sun', 'vibe-aventura': 'compass', 'vibe-natureza': 'trees', 'vibe-churrasco': 'flame', 'vibe-conversa': 'comment',
  'vibe-jogos': 'star', 'vibe-familia': 'heart', 'vibe-festa': 'party', 'vibe-danca': 'music', 'vibe-hiphop': 'mic', 'vibe-futebol': 'dumbbell',
  'vibe-ginasio': 'dumbbell', 'vibe-corrida': 'trending', 'vibe-madrugador': 'sun', 'vibe-noctambulo': 'moon',
  'com-matapa': 'soup', 'com-xima-caril': 'utensils', 'com-camarao-piripiri': 'flame', 'com-lagosta': 'fish', 'com-peixe-grelhado': 'fish', 'com-sushi': 'fish',
  'com-prego': 'sandwich', 'com-pao-chourico': 'sandwich', 'com-pao-frango': 'sandwich', 'com-hamburguer': 'sandwich', 'com-gelado': 'ice-cream', 'com-bolo': 'cake',
  'com-pequeno-almoco': 'coffee', 'com-vegetariano': 'sprout', 'com-salada': 'sprout',
  'sit-bar': 'beer', 'sit-discoteca': 'music', 'sit-lounge': 'sofa', 'sit-karaoke': 'mic', 'sit-esplanada': 'umbrella', 'sit-restaurante': 'utensils',
  'sit-barraca': 'store', 'sit-cafe': 'coffee', 'sit-praia': 'waves', 'sit-jardim': 'trees', 'sit-miradouro': 'mountain', 'sit-mercado': 'store',
  'sit-cinema': 'film', 'sit-estadio': 'dumbbell', 'sit-ginasio': 'dumbbell', 'sit-biblioteca': 'file-text',
};
const BY_CATEGORY: Record<string, IconName> = {
  calma: 'sofa', 'ar-livre': 'sun', convivio: 'users', festa: 'party', musica: 'music', desporto: 'dumbbell', rotina: 'moon',
  'prato-tipico': 'soup', rua: 'sandwich', marisco: 'fish', grelhados: 'flame', doce: 'ice-cream', petisco: 'cake', internacional: 'utensils',
  noite: 'moon', 'comer-beber': 'utensils', 'dia-a-dia': 'store',
};
const BY_KIND: Record<TasteItem['kind'], IconName> = { vibe: 'sparkles', bebida: 'martini', comida: 'utensils', sitio: 'map-pin' };

/** Cores como no site (Tailwind 50 / 200 / 600): cada item fica com a sua, escolhida pelo nome. */
const PALETTES = [
  { from: '#fff1f2', to: '#fecdd3', fg: '#e11d48' },
  { from: '#fffbeb', to: '#fde68a', fg: '#d97706' },
  { from: '#ecfdf5', to: '#a7f3d0', fg: '#059669' },
  { from: '#f5f3ff', to: '#ddd6fe', fg: '#7c3aed' },
  { from: '#f0f9ff', to: '#bae6fd', fg: '#0284c7' },
  { from: '#fdf4ff', to: '#f5d0fe', fg: '#c026d3' },
  { from: '#fff7ed', to: '#fed7aa', fg: '#ea580c' },
  { from: '#f0fdfa', to: '#99f6e4', fg: '#0d9488' },
  { from: '#eef2ff', to: '#c7d2fe', fg: '#4f46e5' },
  { from: '#f7fee7', to: '#d9f99d', fg: '#65a30d' },
];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Bolinha com o ícone do item e a sua cor. `size` é o diâmetro em px. As bebidas levam o desenho da própria bebida. */
export function TasteBubble({ item, size = 44, dim = false }: { item: Pick<TasteItem, 'slug' | 'kind' | 'category'>; size?: number; dim?: boolean }) {
  const glyph = BY_SLUG[item.slug] ?? BY_CATEGORY[item.category] ?? BY_KIND[item.kind];
  const pal = PALETTES[hash(item.slug) % PALETTES.length];
  return (
    <View style={[st.ring, { width: size, height: size, borderRadius: size / 2 }, dim && { opacity: 0.7 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LinearGradient colors={[pal.from, pal.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.fill, { borderRadius: size / 2 }]}>
        {item.kind === 'bebida' ? <DrinkArt slug={item.slug} category={item.category} size={Math.round(size * 0.74)} /> : <Icon name={glyph} size={Math.round(size * 0.46)} strokeWidth={1.7} color={pal.fg} />}
      </LinearGradient>
    </View>
  );
}

const st = StyleSheet.create({
  ring: { borderWidth: 1, borderColor: '#fff', boxShadow: '0 3px 8px rgba(0,0,0,0.12)', overflow: 'hidden' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
