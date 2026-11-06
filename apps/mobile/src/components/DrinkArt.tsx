import type { ReactNode } from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

/**
 * Bebidas desenhadas com a forma que têm: garrafa de cerveja, garrafa de whisky, lata, copo de cocktail, chávena...
 * Cada desenho é plano (cores lisas e um brilho), numa grelha de 48 x 48. A forma e a cor saem do nome (slug) do item.
 */
const C = {
  amber: '#b45309', amberLight: '#f59e0b', brown: '#78350f', dark: '#3b2417', green: '#15803d', greenDark: '#14532d', lime: '#84cc16', red: '#dc2626', wine: '#7f1d1d',
  rose: '#fb7185', whiteWine: '#fde68a', blue: '#2563eb', sky: '#38bdf8', orange: '#f97316', purple: '#7c3aed', pink: '#ec4899', yellow: '#facc15', teal: '#14b8a6',
  cream: '#fef3c7', ink: '#18181b', white: '#ffffff', gold: '#eab308', clear: '#dbeafe', cola: '#7c2d12',
};

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const has = (s: string, ...w: string[]) => w.some((x) => s.includes(x));
const Shine = ({ x, y, h, o = 0.35 }: { x: number; y: number; h: number; o?: number }) => <Rect x={x} y={y} width="2.6" height={h} rx="1.3" fill={C.white} opacity={o} />;

/** Garrafa de cerveja: gargalo, tampa dourada e rótulo. */
const BeerBottle = ({ glass, label }: { glass: string; label: string }) => (
  <G>
    <Path d="M21 5h6v10c0 2.6 6 4.6 6 10v16.5a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V25c0-5.4 6-7.4 6-10z" fill={glass} />
    <Rect x="20.2" y="3" width="7.6" height="3.4" rx="1.2" fill={C.gold} />
    <Rect x="15" y="27" width="18" height="11" fill={C.cream} />
    <Rect x="15" y="30" width="18" height="3.4" fill={label} />
    <Shine x={17.4} y={22} h={17} />
  </G>
);
const BeerCan = ({ body, band }: { body: string; band: string }) => (
  <G>
    <Rect x="15" y="9" width="18" height="33" rx="3.2" fill={body} />
    <Rect x="15" y="9" width="18" height="3.4" rx="1.6" fill={C.white} opacity=".55" />
    <Rect x="15" y="21" width="18" height="9" fill={band} />
    <Ellipse cx="24" cy="9.2" rx="8" ry="1.6" fill={C.white} opacity=".7" />
    <Shine x={17.4} y={13} h={26} />
  </G>
);
/** Garrafa de whisky: ombros quadrados, rolha e rótulo. */
const SquareBottle = ({ glass, label, cork = C.brown, opacity = 1 }: { glass: string; label: string; cork?: string; opacity?: number }) => (
  <G>
    <Rect x="21" y="9" width="6" height="8" fill={glass} opacity={opacity} />
    <Rect x="13.5" y="16" width="21" height="27" rx="3.4" fill={glass} opacity={opacity} />
    <Rect x="20" y="4" width="8" height="6" rx="1.6" fill={cork} />
    <Rect x="15.5" y="24" width="17" height="13" rx="1.4" fill={C.cream} />
    <Rect x="17.5" y="27" width="13" height="2.6" fill={label} />
    <Rect x="19.5" y="31.4" width="9" height="1.8" fill={label} opacity=".55" />
    <Shine x={15.6} y={19} h={21} />
  </G>
);
const RoundBottle = ({ glass, label, cap }: { glass: string; label: string; cap: string }) => (
  <G>
    <Path d="M21.5 5h5v9c0 2 8 4 8 11v15a3.4 3.4 0 0 1-3.4 3.4H16.9A3.4 3.4 0 0 1 13.5 40V25c0-7 8-9 8-11z" fill={glass} />
    <Rect x="20.6" y="3" width="6.8" height="4" rx="1.4" fill={cap} />
    <Rect x="13.5" y="26" width="21" height="11" fill={C.cream} />
    <Rect x="13.5" y="29" width="21" height="3.6" fill={label} />
    <Shine x={16} y={22} h={17} />
  </G>
);
const WineBottle = ({ glass, label, foil }: { glass: string; label: string; foil: string }) => (
  <G>
    <Path d="M22 4h4v14c0 2 5.4 4 5.4 10v13.5a3 3 0 0 1-3 3H19.6a3 3 0 0 1-3-3V28c0-6 5.4-8 5.4-10z" fill={glass} />
    <Rect x="21.4" y="3" width="5.2" height="9" rx="1.2" fill={foil} />
    <Rect x="16.6" y="29" width="14.8" height="10" fill={C.cream} />
    <Rect x="16.6" y="32" width="14.8" height="3" fill={label} />
    <Shine x={18.6} y={25} h={14} />
  </G>
);
const SparklingBottle = () => (
  <G>
    <Path d="M21.5 8h5v9c0 2.4 7 4.4 7 11v13.5a3 3 0 0 1-3 3H17.5a3 3 0 0 1-3-3V28c0-6.6 7-8.6 7-11z" fill={C.greenDark} />
    <Path d="M21 5h6l1 8h-8z" fill={C.gold} />
    <Rect x="20.4" y="3" width="7.2" height="3" rx="1.4" fill={C.cream} />
    <Rect x="14.5" y="29" width="19" height="9" fill={C.gold} />
    <Rect x="14.5" y="32" width="19" height="2.4" fill={C.white} opacity=".7" />
    <Shine x={16.8} y={24} h={16} />
  </G>
);
const Martini = ({ liquid, garnish }: { liquid: string; garnish: string }) => (
  <G>
    <Path d="M7 10h34L24 27z" fill={liquid} opacity=".92" />
    <Path d="M7 10h34" stroke={C.white} strokeWidth="2" strokeLinecap="round" opacity=".8" />
    <Rect x="23" y="26" width="2.4" height="13" fill={C.white} opacity=".85" />
    <Ellipse cx="24" cy="40.6" rx="8" ry="2.2" fill={C.white} opacity=".85" />
    <Path d="M30 4 21 18" stroke={C.brown} strokeWidth="1.4" strokeLinecap="round" />
    <Circle cx="21" cy="18.4" r="3.2" fill={garnish} />
  </G>
);
const Highball = ({ liquid, lime = true }: { liquid: string; lime?: boolean }) => (
  <G>
    <Path d="M13 8h22l-2.6 33a2.4 2.4 0 0 1-2.4 2.2H18a2.4 2.4 0 0 1-2.4-2.2z" fill={C.white} opacity=".5" />
    <Path d="M14 15h20l-1.8 26a2.4 2.4 0 0 1-2.4 2.2H18.2a2.4 2.4 0 0 1-2.4-2.2z" fill={liquid} />
    <Rect x="18" y="20" width="7" height="7" rx="1.6" fill={C.white} opacity=".55" transform="rotate(-10 21 23)" />
    <Rect x="25" y="28" width="6" height="6" rx="1.4" fill={C.white} opacity=".5" transform="rotate(12 28 31)" />
    <Path d="M30 3 26 24" stroke={C.red} strokeWidth="2.4" strokeLinecap="round" />
    {lime && <G><Circle cx="35" cy="11" r="5.4" fill={C.lime} /><Circle cx="35" cy="11" r="3.4" fill="#d9f99d" /></G>}
    <Shine x={16.6} y={12} h={24} o={0.45} />
  </G>
);
const WineGlass = ({ liquid }: { liquid: string }) => (
  <G>
    <Path d="M12 6h24c0 12-4 19-12 19S12 18 12 6z" fill={C.white} opacity=".5" />
    <Path d="M13 14h22c-.6 7-4.4 11-11 11s-10.4-4-11-11z" fill={liquid} />
    <Rect x="23" y="25" width="2.4" height="13" fill={C.white} opacity=".85" />
    <Ellipse cx="24" cy="40.4" rx="8" ry="2.2" fill={C.white} opacity=".85" />
    <Circle cx="33" cy="9" r="4.4" fill={C.orange} /><Circle cx="33" cy="9" r="2.6" fill="#fed7aa" />
  </G>
);
const SodaCan = ({ body, band, tall = false }: { body: string; band: string; tall?: boolean }) => (
  <G>
    <Rect x={tall ? 17 : 15} y={tall ? 5 : 8} width={tall ? 14 : 18} height={tall ? 38 : 34} rx="3" fill={body} />
    <Ellipse cx="24" cy={tall ? 5.4 : 8.4} rx={tall ? 6 : 8} ry="1.6" fill={C.white} opacity=".7" />
    <Rect x={tall ? 17 : 15} y={tall ? 18 : 20} width={tall ? 14 : 18} height={tall ? 12 : 11} fill={band} />
    <Path d={tall ? 'M20 22l4 5 4-5' : 'M19 24c2-3 4 3 6 0s3-1 4 0'} stroke={C.white} strokeWidth="1.8" fill="none" strokeLinecap="round" />
    <Shine x={tall ? 19 : 17.4} y={tall ? 9 : 12} h={tall ? 30 : 26} />
  </G>
);
const SodaBottle = ({ liquid, cap }: { liquid: string; cap: string }) => (
  <G>
    <Path d="M21 8h6v6c0 2 6 3.6 6 8v19a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V22c0-4.4 6-6 6-8z" fill={liquid} />
    <Rect x="20.4" y="4" width="7.2" height="5" rx="1.4" fill={cap} />
    <Rect x="15" y="26" width="18" height="9" fill={C.white} opacity=".88" />
    <Path d="M15 22h18" stroke={C.white} strokeWidth="1.4" opacity=".6" />
    <Shine x={17.2} y={19} h={21} />
  </G>
);
const JuiceGlass = ({ juice, fruit }: { juice: string; fruit: string }) => (
  <G>
    <Path d="M12 12h24l-2.2 29a2.4 2.4 0 0 1-2.4 2.2H16.6a2.4 2.4 0 0 1-2.4-2.2z" fill={C.white} opacity=".5" />
    <Path d="M13 18h22l-1.8 23a2.4 2.4 0 0 1-2.4 2.2H17.2a2.4 2.4 0 0 1-2.4-2.2z" fill={juice} />
    <Path d="M31 3 26 26" stroke={C.red} strokeWidth="2.4" strokeLinecap="round" />
    <Circle cx="12.6" cy="12.6" r="6" fill={fruit} /><Circle cx="12.6" cy="12.6" r="3.6" fill={C.white} opacity=".5" />
    <Shine x={16} y={16} h={22} o={0.45} />
  </G>
);
const Coconut = () => (
  <G>
    <Circle cx="24" cy="28" r="14.4" fill={C.brown} />
    <Path d="M12.5 21a14 14 0 0 1 23 0c-3-2-6-2.6-11.5-2.6S15.5 19 12.5 21z" fill={C.white} />
    <Path d="M30 3 25 22" stroke={C.green} strokeWidth="2.6" strokeLinecap="round" />
    <Circle cx="19" cy="31" r="1.5" fill={C.dark} /><Circle cx="25" cy="33" r="1.5" fill={C.dark} />
    <Shine x={15} y={26} h={9} o={0.3} />
  </G>
);
const Cup = ({ drink, tea = false, mug = false }: { drink: string; tea?: boolean; mug?: boolean }) => (
  <G>
    <Path d="M17 7q-3 3 0 6M24 5q-3 4 0 8M31 7q-3 3 0 6" stroke={C.white} strokeWidth="2" strokeLinecap="round" fill="none" opacity=".7" />
    <Path d={mug ? 'M9 17h26v17a8 8 0 0 1-8 8H17a8 8 0 0 1-8-8z' : 'M8 18h28l-3 16a8 8 0 0 1-7.8 6.4h-6.4A8 8 0 0 1 11 34z'} fill={C.white} />
    <Path d={mug ? 'M9 17h26v5H9z' : 'M8 18h28l-.9 5H8.9z'} fill={drink} />
    <Path d="M35 22h3.4a4 4 0 0 1 0 8H33" stroke={C.white} strokeWidth="2.8" fill="none" strokeLinecap="round" />
    <Ellipse cx="22" cy="43.4" rx="14" ry="2" fill={C.white} opacity=".7" />
    {tea && <G><Path d="M28 18 31 11" stroke={C.dark} strokeWidth="1.2" /><Rect x="29.6" y="8" width="4.4" height="4.4" rx="1" fill={C.green} /></G>}
  </G>
);
const MilkGlass = ({ milk, straw = false }: { milk: string; straw?: boolean }) => (
  <G>
    <Path d="M12 8h24l-2.4 33a2.4 2.4 0 0 1-2.4 2.2H16.8a2.4 2.4 0 0 1-2.4-2.2z" fill={C.white} opacity=".5" />
    <Path d="M13 14h22l-1.8 27a2.4 2.4 0 0 1-2.4 2.2H17.2a2.4 2.4 0 0 1-2.4-2.2z" fill={milk} />
    <Path d="M13 14h22" stroke={C.white} strokeWidth="3" strokeLinecap="round" />
    {straw && <Path d="M31 3 27 26" stroke={C.pink} strokeWidth="2.4" strokeLinecap="round" />}
    <Shine x={16} y={14} h={24} o={0.5} />
  </G>
);
const WaterBottle = ({ cap = C.blue }: { cap?: string }) => (
  <G>
    <Path d="M21 7h6v5c0 2 6 3 6 8v21a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V20c0-5 6-6 6-8z" fill={C.sky} opacity=".85" />
    <Rect x="20.4" y="3" width="7.2" height="5" rx="1.4" fill={cap} />
    <Rect x="15" y="25" width="18" height="9" fill={C.white} opacity=".85" />
    <Path d="M24 27.6c-1.6 2-2.4 3-2.4 4.2a2.4 2.4 0 0 0 4.8 0c0-1.2-.8-2.2-2.4-4.2z" fill={C.blue} />
    <Shine x={17.2} y={16} h={22} o={0.5} />
  </G>
);
const Jug = ({ clay }: { clay: string }) => (
  <G>
    <Path d="M18 6h12v6c0 2 7 4 7 14a13 13 0 0 1-26 0c0-10 7-12 7-14z" fill={clay} />
    <Rect x="16.4" y="4" width="15.2" height="4.6" rx="2.2" fill={C.dark} opacity=".75" />
    <Path d="M13 26h22" stroke={C.cream} strokeWidth="2" opacity=".7" /><Path d="M14 31h20" stroke={C.cream} strokeWidth="2" opacity=".5" />
    <Shine x={15} y={20} h={13} o={0.28} />
  </G>
);
const Carton = ({ body }: { body: string }) => (
  <G>
    <Path d="M13 12h22l2 4v26H11V16z" fill={body} />
    <Path d="M13 12l11-6 11 6z" fill={C.cream} />
    <Rect x="11" y="23" width="26" height="11" fill={C.cream} opacity=".92" />
    <Path d="M16 28.5h16" stroke={body} strokeWidth="2.4" strokeLinecap="round" />
  </G>
);

type Art = { node: ReactNode };

/** Escolhe o desenho pelo nome (slug) e pelo grupo do item. */
function pick(slug: string, category: string): Art {
  const s = slug.replace(/^beb-/, '');
  const h = hash(slug);
  const pickOf = <T,>(xs: T[]) => xs[h % xs.length];
  switch (category) {
    case 'cerveja': {
      if (has(s, 'preta', 'stout', 'guinness', 'black', 'porter')) return { node: <BeerBottle glass={C.dark} label={C.gold} /> };
      if (has(s, 'sidra', 'cidre', 'somersby', 'strongbow', 'magners', 'ice', 'redd', 'brutal', 'savanna', 'hunters', 'radler')) return { node: <BeerCan body={pickOf([C.lime, C.yellow, C.orange])} band={C.white} /> };
      if (has(s, 'castle-lite', 'lite', 'light', 'ultra', 'zero', '0-0')) return { node: <BeerCan body={C.sky} band={C.white} /> };
      if (has(s, 'corona', 'heineken', 'stella', 'carlsberg', 'tiger', 'peroni', 'asahi', 'sapporo', 'amstel', 'super-bock', 'sagres', 'budweiser')) return { node: <BeerBottle glass={pickOf([C.green, C.greenDark, C.amberLight])} label={pickOf([C.red, C.blue, C.green])} /> };
      return { node: <BeerBottle glass={pickOf([C.amber, C.amberLight, C.brown])} label={pickOf([C.red, C.blue, C.green, C.orange])} /> };
    }
    case 'destilado': {
      if (has(s, 'whisky', 'whiskey', 'jack', 'johnnie', 'jameson', 'brandy', 'hennessy', 'cognac')) return { node: <SquareBottle glass={C.amber} label={C.ink} /> };
      if (has(s, 'vodka', 'absolut', 'smirnoff')) return { node: <SquareBottle glass={C.clear} label={C.blue} cork={C.ink} opacity={0.92} /> };
      if (has(s, 'gin', 'gordon')) return { node: <SquareBottle glass={C.green} label={C.white} cork={C.ink} /> };
      if (has(s, 'rum', 'bacardi')) return { node: <SquareBottle glass={C.dark} label={C.gold} cork={C.brown} /> };
      if (has(s, 'tequila')) return { node: <SquareBottle glass={C.whiteWine} label={C.green} cork={C.brown} opacity={0.95} /> };
      if (has(s, 'baileys', 'amarula', 'licor', 'ginjinha', 'jager', 'beirao')) return { node: <RoundBottle glass={has(s, 'ginjinha') ? C.wine : has(s, 'jager') ? C.greenDark : '#a16207'} label={C.gold} cap={C.ink} /> };
      return { node: <SquareBottle glass={pickOf([C.amber, C.clear, C.green])} label={C.ink} /> };
    }
    case 'vinho': {
      if (has(s, 'champanhe', 'espumante', 'prosecco')) return { node: <SparklingBottle /> };
      if (has(s, 'sangria')) return { node: <WineGlass liquid={C.wine} /> };
      if (has(s, 'branco', 'verde', 'moscatel')) return { node: <WineBottle glass="#a3b84a" label={C.green} foil={C.cream} /> };
      if (has(s, 'rose')) return { node: <WineBottle glass="#f9a8b8" label={C.pink} foil={C.rose} /> };
      return { node: <WineBottle glass={C.wine} label={C.red} foil={C.dark} /> };
    }
    case 'cocktail': {
      if (has(s, 'mojito', 'caipirinha', 'cuba', 'long-island', 'moscow')) return { node: <Highball liquid={has(s, 'cuba', 'long') ? C.cola : '#bef264'} /> };
      if (has(s, 'aperol')) return { node: <WineGlass liquid={C.orange} /> };
      if (has(s, 'pina', 'sex')) return { node: <Highball liquid={has(s, 'pina') ? '#fef9c3' : '#fb923c'} lime={false} /> };
      return { node: <Martini liquid={pickOf([C.rose, C.orange, C.pink, '#fde047'])} garnish={pickOf([C.red, C.lime, C.orange])} /> };
    }
    case 'refrigerante': {
      if (has(s, 'coca')) return { node: <SodaCan body={C.red} band={C.white} /> };
      if (has(s, 'fanta', 'mirinda', 'mazoe')) return { node: <SodaCan body={C.orange} band={C.white} /> };
      if (has(s, 'sprite', '7up', 'soda')) return { node: <SodaCan body={C.green} band={C.lime} /> };
      if (has(s, 'pepsi', 'vimto')) return { node: <SodaCan body={C.blue} band={C.red} /> };
      if (has(s, 'tonica', 'schweppes', 'ginger', 'agua')) return { node: <SodaBottle liquid={C.clear} cap={C.teal} /> };
      return { node: <SodaCan body={pickOf([C.purple, C.teal, C.pink, C.orange])} band={C.white} /> };
    }
    case 'energia':
      return { node: <SodaCan tall body={has(s, 'red-bull') ? C.blue : pickOf([C.ink, C.green, C.red, C.orange])} band={has(s, 'red-bull') ? C.sky : C.yellow} /> };
    case 'sumo': {
      if (has(s, 'coco')) return { node: <Coconut /> };
      const colors: [string, string, string][] = [
        ['laranja', C.orange, C.orange], ['manga', C.amberLight, C.yellow], ['maracuja', C.yellow, C.yellow], ['melancia', C.rose, C.red], ['morango', C.red, C.red], ['uva', C.purple, C.purple],
        ['limao', '#d9f99d', C.lime], ['limonada', '#fef08a', C.yellow], ['cenoura', C.orange, C.orange], ['tomate', C.red, C.red], ['ananas', C.yellow, C.yellow], ['caju', C.amberLight, C.red],
        ['goiaba', C.rose, C.rose], ['papaia', C.orange, C.orange], ['tamarindo', C.brown, C.brown], ['maca', '#bef264', C.lime], ['gengibre', '#fde68a', C.amberLight], ['batido', C.pink, C.red],
      ];
      const f = colors.find(([k]) => s.includes(k));
      return { node: <JuiceGlass juice={f ? f[1] : pickOf([C.orange, C.amberLight, C.lime])} fruit={f ? f[2] : C.orange} /> };
    }
    case 'cafe-cha': {
      if (has(s, 'cha-gelado')) return { node: <Highball liquid={C.amber} lime /> };
      if (has(s, 'cha')) return { node: <Cup drink={has(s, 'verde', 'hortela', 'capim') ? '#86efac' : has(s, 'rooibos') ? '#c2410c' : C.amberLight} tea /> };
      if (has(s, 'chocolate')) return { node: <Cup drink={C.brown} mug /> };
      if (has(s, 'gelado')) return { node: <Highball liquid={C.dark} lime={false} /> };
      return { node: <Cup drink={has(s, 'leite', 'cappuccino', 'latte', 'galao') ? '#c08457' : C.dark} /> };
    }
    case 'leite':
      if (has(s, 'chocolate')) return { node: <MilkGlass milk={C.brown} straw /> };
      if (has(s, 'morango')) return { node: <MilkGlass milk={C.rose} straw /> };
      if (has(s, 'baunilha')) return { node: <MilkGlass milk={C.cream} straw /> };
      return { node: <MilkGlass milk={C.white} /> };
    case 'agua':
      return { node: <WaterBottle cap={has(s, 'aroma') ? C.pink : C.blue} /> };
    case 'tradicional':
      return { node: has(s, 'chibuku') ? <Carton body={C.red} /> : <Jug clay={pickOf(['#c2410c', '#a16207', '#92400e'])} /> };
    default:
      return { node: <JuiceGlass juice={C.orange} fruit={C.orange} /> };
  }
}

/** O desenho da bebida, em `size` px. */
export function DrinkArt({ slug, category, size = 40 }: { slug: string; category: string; size?: number }) {
  return (
    <Svg viewBox="0 0 48 48" width={size} height={size}>
      {pick(slug, category).node}
    </Svg>
  );
}
