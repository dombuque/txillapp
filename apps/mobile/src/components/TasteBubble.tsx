import { LinearGradient } from 'expo-linear-gradient';
import {
  Anchor, Apple, Banana, Beef, Beer, Bird, BookOpen, Cake, CakeSlice, Candy, Car, Carrot,
  Cherry, Citrus, Coffee, Cookie, Croissant, Crown, CupSoda, Dessert, Dices, Disc3, Drum, Drumstick,
  Dumbbell, Egg, EggFried, Fish, Flame, Flower, Footprints, Gamepad2, Goal, GlassWater, Grape, Guitar,
  Ham, Headphones, Heart, IceCreamBowl, IceCreamCone, Leaf, Library, Martini, MessageCircle, Mic, Milk, Moon,
  MoonStar, Mountain, Music, Nut, PartyPopper, Pizza, Popcorn, Radio, Rocket, Salad, Sandwich, Shell,
  ShoppingBag, ShoppingBasket, Snowflake, Sofa, Soup, Sparkles, Sprout, Star, Store, Sun, Sunrise, Sunset,
  Trees, Trophy, Tv, Umbrella, Users, Utensils, UtensilsCrossed, Waves, Wheat, Wine, Zap, Armchair,
  ChefHat, Clapperboard, MapPin, TreePalm,
  type LucideIcon,
} from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import type { TasteItem } from '@/lib/api.geleira';
import { DrinkArt } from './DrinkArt';
import { Mango } from './MangoIcon';

/** Um ícone por item do catálogo (nada de prateleiras com tudo igual). */
const BY_SLUG: Record<string, LucideIcon> = {
  // vibes
  'vibe-chill': Sofa, 'vibe-sofa-series': Tv, 'vibe-leitura': BookOpen, 'vibe-musica-baixinho': Headphones, 'vibe-pe-na-areia': Umbrella,
  'vibe-por-do-sol': Sunset, 'vibe-aventura': Car, 'vibe-natureza': Trees, 'vibe-churrasco': Flame, 'vibe-conversa': MessageCircle,
  'vibe-jogos': Gamepad2, 'vibe-familia': Heart, 'vibe-festa': PartyPopper, 'vibe-danca': Disc3, 'vibe-marrabenta': Guitar,
  'vibe-amapiano': Music, 'vibe-hiphop': Mic, 'vibe-pandza': Drum, 'vibe-afrobeats': Radio, 'vibe-futebol': Goal,
  'vibe-ginasio': Dumbbell, 'vibe-corrida': Footprints, 'vibe-madrugador': Sunrise, 'vibe-noctambulo': MoonStar,
  // bebidas sem álcool
  'beb-coca-cola': CupSoda, 'beb-fanta': Candy, 'beb-sprite': Leaf, 'beb-tonica': Zap, 'beb-sumol': Cherry, 'beb-cappy': Apple,
  'beb-maracuja': Flower, 'beb-manga': Mango, 'beb-laranja': Citrus, 'beb-ananas': Crown, 'beb-agua-coco': TreePalm, 'beb-cafe': Coffee,
  'beb-cha-limao': Sprout, 'beb-cha-gengibre': Carrot, 'beb-cappuccino': Milk, 'beb-energetica': Rocket, 'beb-agua': GlassWater, 'beb-batido': Banana,
  // bebidas com álcool
  'beb-laurentina': Beer, 'beb-2m': Trophy, 'beb-manica': Mountain, 'beb-castle': Star, 'beb-heineken': Anchor, 'beb-cerveja-milho': Wheat,
  'beb-cajueiro': Nut, 'beb-vinho-tinto': Grape, 'beb-vinho-branco': Wine, 'beb-vinho-rose': Heart, 'beb-espumante': Sparkles, 'beb-whisky': Dices,
  'beb-vodka': Snowflake, 'beb-gin': Martini, 'beb-rum': Shell, 'beb-ginjinha': Cherry, 'beb-cocktail': PartyPopper, 'beb-sidra': Apple,
  // comidas
  'com-matapa': Soup, 'com-xima-caril': UtensilsCrossed, 'com-caril-amendoim': Nut, 'com-frango-zambeziana': Drumstick, 'com-camarao-piripiri': Flame,
  'com-lagosta': Crown, 'com-caranguejo': Shell, 'com-ostras': Waves, 'com-peixe-grelhado': Fish, 'com-frango-grelhado': Drumstick,
  'com-espetadas': Beef, 'com-bife': EggFried, 'com-feijoada': ChefHat, 'com-mucapata': Wheat, 'com-mandioca-cozida': Carrot,
  'com-arroz-coco': TreePalm, 'com-badjias': Cookie, 'com-samosas': Croissant, 'com-chamussas': Croissant, 'com-rissois': Egg,
  'com-pao-chourico': Ham, 'com-pao-frango': Sandwich, 'com-prego': Sandwich, 'com-hamburguer': Beef, 'com-pizza': Pizza, 'com-batata-frita': Zap,
  'com-kebab': Utensils, 'com-sushi': Fish, 'com-massa': UtensilsCrossed, 'com-salada': Salad, 'com-vegetariano': Leaf, 'com-bolinhos': Cookie,
  'com-pasteis-nata': Dessert, 'com-gelado': IceCreamCone, 'com-bolo': Cake, 'com-chocolate': CakeSlice, 'com-manga-verde': Mango,
  'com-pipocas': Popcorn, 'com-amendoim': Nut, 'com-castanha-caju': Nut, 'com-pequeno-almoco': Coffee,
  // sítios
  'sit-bar': Beer, 'sit-discoteca': Disc3, 'sit-lounge': Armchair, 'sit-karaoke': Mic, 'sit-esplanada': Umbrella, 'sit-restaurante': Utensils,
  'sit-barraca': Store, 'sit-cafe': Coffee, 'sit-pastelaria': Croissant, 'sit-praia': Waves, 'sit-jardim': Trees, 'sit-miradouro': Mountain,
  'sit-piscina': GlassWater, 'sit-mercado': ShoppingBasket, 'sit-centro-comercial': ShoppingBag, 'sit-cinema': Clapperboard, 'sit-estadio': Goal,
  'sit-ginasio': Dumbbell, 'sit-biblioteca': Library,
};

/** Itens sugeridos pela malta (sem ícone próprio): um por grupo. */
const BY_CATEGORY: Record<string, LucideIcon> = {
  calma: Sofa, 'ar-livre': Sun, convivio: Users, festa: PartyPopper, musica: Music, desporto: Dumbbell, rotina: Moon,
  refrigerante: CupSoda, sumo: GlassWater, 'cafe-cha': Coffee, cerveja: Beer, vinho: Wine, destilado: Martini, tradicional: Beer,
  'prato-tipico': Soup, rua: Sandwich, marisco: Fish, grelhados: Flame, doce: IceCreamBowl, petisco: Cake, internacional: Utensils,
  noite: Moon, 'comer-beber': Utensils, 'dia-a-dia': Store,
};
/** Bebidas novas sem ícone próprio: cada uma pega num do grupo, escolhido pelo nome, para o grupo não ficar todo igual. */
const CYCLE: Record<string, LucideIcon[]> = {
  refrigerante: [CupSoda, Candy, Zap, Snowflake, Cherry, Sparkles, Leaf, Flower],
  energia: [Zap, Rocket, Flame, Dumbbell, Trophy],
  sumo: [Citrus, Apple, Cherry, Grape, Banana, Carrot, Sprout, Sun, TreePalm],
  'cafe-cha': [Coffee, Leaf, Sprout, Milk, Cookie, Flame, Snowflake],
  leite: [Milk, Cookie, Cherry, Cake, Heart, Wheat],
  agua: [GlassWater, Waves, Snowflake, Sparkles],
  cerveja: [Beer, Wheat, Anchor, Star, Trophy, Mountain, Crown, Shell, Dices],
  tradicional: [TreePalm, Nut, Wheat, Flame],
  vinho: [Wine, Grape, Heart, Sparkles, Crown],
  destilado: [Martini, Flame, Dices, Crown, Snowflake, Anchor, Shell, Star],
  cocktail: [Martini, PartyPopper, Citrus, Cherry, Sparkles, Sun, Moon, Flower],
};
const BY_KIND: Record<TasteItem['kind'], LucideIcon> = { vibe: Sparkles, bebida: Wine, comida: Utensils, sitio: MapPin };

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
  const cyc = CYCLE[item.category];
  const Glyph = BY_SLUG[item.slug] ?? (item.kind === 'bebida' && cyc ? cyc[hash(item.slug) % cyc.length] : undefined) ?? BY_CATEGORY[item.category] ?? BY_KIND[item.kind];
  const pal = PALETTES[hash(item.slug) % PALETTES.length];
  return (
    <View style={[st.ring, { width: size, height: size, borderRadius: size / 2 }, dim && { opacity: 0.7 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LinearGradient colors={[pal.from, pal.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.fill, { borderRadius: size / 2 }]}>
        {item.kind === 'bebida' ? <DrinkArt slug={item.slug} category={item.category} size={Math.round(size * 0.74)} /> : <Glyph size={Math.round(size * 0.46)} strokeWidth={1.7} color={pal.fg} />}
      </LinearGradient>
    </View>
  );
}

const st = StyleSheet.create({
  ring: { borderWidth: 1, borderColor: '#fff', boxShadow: '0 3px 8px rgba(0,0,0,0.12)', overflow: 'hidden' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
