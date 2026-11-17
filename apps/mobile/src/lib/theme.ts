/** Cores do Txillapp: as mesmas do site (Tailwind: coral da marca + cinzentos "zinc"). */
export const colors = {
  brand: '#d6334f',
  brandLight: '#e5506a',
  /** O laranja do gradiente da marca (do selo e do Mixar): o realce por cima da imagem da câmara (zoom, foco, exposição). */
  brandWarm: '#ff9a5b',
  canvas: '#ebebea',
  white: '#ffffff',
  zinc50: '#fafafa',
  zinc100: '#f4f4f5',
  zinc200: '#e4e4e7',
  zinc300: '#d4d4d8',
  zinc400: '#a1a1aa',
  zinc500: '#71717a',
  zinc600: '#52525b',
  zinc700: '#3f3f46',
  zinc800: '#27272a',
  zinc900: '#18181b',
  amber600: '#d97706',
  amber300: '#fcd34d',
  green600: '#16a34a',
  green700: '#15803d',
  red600: '#dc2626',
  /** O vermelho das ações perigosas (Apagar, Bloquear, Denunciar, Sair): o mesmo da caixa de confirmação. */
  danger: '#b91c1c',
  /** O fundo claro do botão perigoso (texto em `danger`). */
  dangerSoft: '#fef2f2',
  rose50: '#fff1f2',
  sky: '#1d9bf0',
};

/**
 * As superfícies escuras (folhas e painéis por cima de vídeo ou câmara: tcheka, mimo, Zás, Txillada, estúdio).
 * `bg` o fundo, `raised` o que fica por cima (botão, campo, linha tocada), `line` os traços, `text` e `sub` as letras.
 */
export const dark = {
  bg: '#1c1c1e',
  raised: '#2c2c2e',
  line: 'rgba(255,255,255,0.12)',
  text: '#ffffff',
  sub: '#a1a1aa',
  /** A pega de arrastar da folha escura. */
  handle: '#5a5a5e',
  /** Os ícones na folha escura. */
  icon: '#e5e5ea',
  /** O vidro por cima do vídeo (botões redondos sobre a imagem). */
  glass: 'rgba(0,0,0,0.38)',
} as const;

/** A escala de letra: o mesmo papel tem sempre o mesmo tamanho e peso. */
export const type = {
  /** Título de ecrã (StackPage). */
  title: { fontSize: 20, fontWeight: '800' },
  /** Título de folha, de estado vazio e de erro. */
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 14, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '500' },
} as const;
/** O mesmo que `type` (para importar sem a ambiguidade de `import { type }`). */
export const typo = type;

/** Raios: botões, chips e campos de pesquisa são sempre pílulas. */
export const radius = { pill: 999, sheet: 28, card: 24, md: 16, sm: 12 } as const;

/** Alturas dos botões: `lg` CTA de ecrã inteiro e de folha, `md` dentro de cartões e listas, `sm` chips de ação. */
export const buttonHeight = { lg: 52, md: 44, sm: 36 } as const;

/** A área de toque mínima (botões só com ícone, chips): o que for mais pequeno ganha `hitSlop` até aqui. */
export const minTouch = 44;

/** Tamanhos de ícone por papel (o mesmo papel, o mesmo tamanho em toda a app). */
export const iconSize = {
  /** Fila de ações de uma publicação (Brindar, Comentar, Repostar, Oferecer, Partilhar). */
  action: 24,
  /** Rail do vídeo (tchekas). */
  rail: 28,
  /** Ícones do cabeçalho do ecrã. */
  header: 24,
  /** Ícone de uma linha de menu (ActionRow). */
  menu: 22,
  /** Dentro de um campo ou de um chip. */
  field: 18,
  /** O X de uma folha. */
  sheetClose: 20,
  /** O X de um ecrã inteiro (visor, câmara). */
  screenClose: 24,
  /** O ícone grande dos estados vazios e de erro. */
  state: 44,
} as const;

/** Opacidade de um botão desligado. */
export const disabledOpacity = 0.45;

export type ButtonKind = 'primary' | 'gradient' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid';

/** O degradê coral do botão `gradient` (entrar, criar conta, a apresentação): da marca ao coral claro, da esquerda para a direita. */
export const brandGradient = [colors.brand, colors.brandLight] as const;
export type ButtonSize = keyof typeof buttonHeight;

/**
 * O aspeto de um botão (components/ui/Button): altura, letra, cores e o `hitSlop` que falta para chegar aos 44.
 * `onDark`: o botão está numa superfície escura (folha escura, por cima de vídeo).
 */
export function buttonLook(kind: ButtonKind = 'primary', size: ButtonSize = 'lg', onDark = false) {
  const height = buttonHeight[size];
  const fg =
    kind === 'primary' || kind === 'gradient' || kind === 'dangerSolid' ? '#ffffff'
    : kind === 'danger' ? (onDark ? '#fca5a5' : colors.danger)
    : onDark ? dark.text : colors.zinc900;
  const bg =
    kind === 'primary' || kind === 'gradient' ? colors.brand
    : kind === 'dangerSolid' ? colors.danger
    : kind === 'danger' ? (onDark ? 'rgba(185,28,28,0.22)' : colors.dangerSoft)
    : kind === 'secondary' ? (onDark ? dark.raised : colors.zinc100)
    : 'transparent';
  // Passar o rato (web e computador): os cheios clareiam um pouco; os outros ganham um fundo um tom acima.
  const hoverBg =
    kind === 'secondary' ? (onDark ? '#3a3a3c' : colors.zinc200)
    : kind === 'ghost' ? (onDark ? dark.raised : colors.zinc100)
    : kind === 'danger' ? (onDark ? 'rgba(185,28,28,0.32)' : '#fee2e2')
    : null;
  return {
    height,
    bg,
    fg,
    /** Fundo ao passar o rato (null: os cheios só clareiam, com `hoverOpacity`). */
    hoverBg,
    hoverOpacity: hoverBg ? 1 : 0.92,
    radius: radius.pill,
    fontSize: size === 'sm' ? 14 : 16,
    fontWeight: '700' as const,
    paddingHorizontal: size === 'sm' ? 14 : size === 'md' ? 18 : 22,
    iconSize: size === 'sm' ? 16 : 18,
    hitSlop: Math.max(0, Math.ceil((minTouch - height) / 2)),
  };
}

/** Sombra suave dos cartões (a mesma do site: 0 2px 16px com 9% de preto). */
export const cardShadow = { boxShadow: '0 2px 16px rgba(0,0,0,0.09)' } as const;
