/**
 * Os nomes e as descrições dos efeitos do estúdio como a pessoa os lê, no idioma ativo. Só a interface usa isto:
 * effects.ts, capulana.ts e capulanaShapes.ts são cópias iguais às da montagem no servidor (apps/api/src/compose, ver
 * effects-sync.spec.ts) e não podem importar o i18n da app, por isso guardam só o nome em português (que fica de reserva
 * para um id que aqui não esteja). Cada frase vai literal em `t('…')` para o scripts/i18n/extract.mjs a apanhar.
 */
import { t } from '@/lib/i18n';
import type { PaletteId, PatternId } from './capulana';
import type { CapulanaShapeId, CapulanaTransitionId } from './capulanaShapes';
import type { AdjustKey, AnimIn, AnimLoop, FontId, RampId, TransitionId } from './effects';

type Labels<K extends string> = Partial<Record<K, () => string>>;
const pick = <K extends string>(l: Labels<K>, id: string, fallback = ''): string => l[id as K]?.() ?? fallback;

// ---------------------------------------------------------------- filtros

const FILTER_NAMES: Labels<string> = {
  normal: () => 'Normal',
  matapa: () => t('Matapa'),
  'costa-do-sol': () => t('Costa do Sol'),
  xima: () => t('Xima'),
  'noite-de-maputo': () => t('Noite de Maputo'),
  marrabenta: () => t('Marrabenta'),
  capulana: () => t('Capulana'),
  ilha: () => t('Ilha'),
  tofo: () => t('Tofo'),
  gorongosa: () => t('Gorongosa'),
  limpopo: () => t('Limpopo'),
  cacimba: () => t('Cacimba'),
  vintage: () => t('Vintage'),
  pb: () => 'P&B',
  polana: () => t('Polana'),
  txillapp: () => 'Txillapp',
};
const FILTER_MOODS: Labels<string> = {
  normal: () => t('Sem filtro'),
  matapa: () => t('Verde fundo da folha de mandioca, terra quente'),
  'costa-do-sol': () => t('Fim de tarde dourado na marginal'),
  xima: () => t('Claro, cremoso e suave'),
  'noite-de-maputo': () => t('Néon azul e magenta, sombras frias'),
  marrabenta: () => t('Vivo, quente e com contraste, para dançar'),
  capulana: () => t('Cores fortes como um pano novo'),
  ilha: () => t('Turquesa e pedra branca da Ilha de Moçambique'),
  tofo: () => t('Oceano azul e verde, de mergulho'),
  gorongosa: () => t('Savana: verdes de terra e luz dura'),
  limpopo: () => t('Pôr do sol laranja sobre o rio'),
  cacimba: () => t('Neblina da manhã, tudo calmo'),
  vintage: () => t('Machimbombo dos anos 70, com grão'),
  pb: () => t('Mafalala a preto e branco, documental'),
  polana: () => t('Preto e branco suave e elegante'),
  txillapp: () => t('O coral da casa'),
};
export const filterName = (f: { id: string; name: string }) => pick(FILTER_NAMES, f.id, f.name);
export const filterMood = (f: { id: string; mood: string }) => pick(FILTER_MOODS, f.id, f.mood);

// ---------------------------------------------------------------- ajustes

const ADJUST_LABELS: Labels<AdjustKey> = {
  brightness: () => t('Brilho'),
  contrast: () => t('Contraste'),
  saturation: () => t('Saturação'),
  temperature: () => t('Temperatura'),
  hue: () => t('Matiz'),
  sharpen: () => t('Nitidez'),
  vignette: () => t('Vinheta'),
  grain: () => t('Grão'),
};
export const adjustLabel = (a: { id: AdjustKey; label: string }) => pick(ADJUST_LABELS, a.id, a.label);

// ---------------------------------------------------------------- velocidade

const RAMP_NAMES: Labels<RampId> = {
  montaria: () => t('Montaria'),
  heroi: () => t('Herói'),
  bala: () => t('Bala'),
  flash: () => t('Flash'),
};
const RAMP_MOODS: Labels<RampId> = {
  montaria: () => t('Rápido, lento, rápido, lento'),
  heroi: () => t('Normal e câmara lenta no momento'),
  bala: () => t('Muito rápido e quase parado a meio'),
  flash: () => t('Calmo e um disparo a 4×'),
};
export const rampName = (r: { id: string; name: string }) => pick(RAMP_NAMES, r.id, r.name);
export const rampMood = (r: { id: string; mood: string }) => pick(RAMP_MOODS, r.id, r.mood);

// ---------------------------------------------------------------- transições

const TRANSITION_NAMES: Labels<TransitionId> = {
  corte: () => t('Corte'),
  fundido: () => t('Fundido'),
  'deslizar-esquerda': () => t('Esquerda'),
  'deslizar-direita': () => t('Direita'),
  'deslizar-cima': () => t('Cima'),
  'deslizar-baixo': () => t('Baixo'),
  zoom: () => t('Zoom'),
  desfoque: () => t('Desfoque'),
  girar: () => t('Girar'),
  flash: () => t('Flash'),
  brilho: () => t('Brilho', { context: 'efeito' }),
  glitch: () => t('Glitch'),
  'capulana-deslizar': () => t('Pano'),
  'capulana-desenrolar': () => t('Desenrolar'),
  'capulana-rasgar': () => t('Rasgar'),
  'capulana-losango': () => t('Losango'),
  'capulana-vento': () => t('Ao vento'),
};
const CAPULANA_TRANSITION_MOODS: Labels<CapulanaTransitionId> = {
  'capulana-deslizar': () => t('O pano atravessa o ecrã de lado, com a franja à frente'),
  'capulana-desenrolar': () => t('O pano desenrola-se de cima e volta a enrolar'),
  'capulana-rasgar': () => t('Dois panos fecham em ziguezague e rasgam para os lados'),
  'capulana-losango': () => t('Um losango de pano abre do centro'),
  'capulana-vento': () => t('O pano passa na diagonal, a ondular'),
};
export const transitionName = (tr: { id: string; name: string }) => pick(TRANSITION_NAMES, tr.id, tr.name);
export const transitionMood = (tr: { id: string; mood: string }) => pick(CAPULANA_TRANSITION_MOODS, tr.id, tr.mood);

// ---------------------------------------------------------------- animações das camadas

const ANIM_NAMES: Labels<AnimIn> = {
  nenhuma: () => t('Nenhuma'),
  aparecer: () => t('Aparecer'),
  maquina: () => t('Máquina de escrever'),
  subir: () => t('Subir'),
  pop: () => t('Pop'),
  brilho: () => t('Brilho', { context: 'efeito' }),
  ondulacao: () => t('Ondulação'),
};
const LOOP_NAMES: Labels<AnimLoop> = {
  nenhuma: () => t('Parado'),
  pulsar: () => t('Pulsar'),
  balancar: () => t('Balançar'),
};
export const animName = (a: { id: string; name: string }) => pick(ANIM_NAMES, a.id, a.name);
export const loopName = (a: { id: string; name: string }) => pick(LOOP_NAMES, a.id, a.name);

// ---------------------------------------------------------------- fontes

const FONT_NAMES: Labels<FontId> = {
  classica: () => t('Clássica'),
  cartaz: () => t('Cartaz'),
  grito: () => t('Grito'),
  praia: () => t('Praia'),
  marcador: () => t('Marcador'),
  elegante: () => t('Elegante'),
  maquina: () => t('Máquina'),
  retro: () => t('Retro'),
  mao: () => t('À mão'),
  futuro: () => t('Futuro'),
};
export const fontName = (f: { id: string; name: string }) => pick(FONT_NAMES, f.id, f.name);

// ---------------------------------------------------------------- capulana (panos e stickers)

const PATTERN_NAMES: Labels<PatternId> = {
  losangos: () => t('Losangos'),
  ziguezague: () => t('Ziguezague'),
  circulos: () => t('Círculos'),
  flores: () => t('Flores'),
  faixas: () => t('Faixas'),
  escamas: () => t('Escamas'),
  sol: () => t('Sol'),
  degraus: () => t('Degraus'),
};
const PATTERN_MOODS: Labels<PatternId> = {
  losangos: () => t('Losangos dentro de losangos'),
  ziguezague: () => t('Ondas em bico, de lado a lado'),
  circulos: () => t('Círculos uns dentro dos outros'),
  flores: () => t('Flores de pétalas largas'),
  faixas: () => t('Barras com triângulos e contas'),
  escamas: () => t('Leques sobrepostos, como escamas'),
  sol: () => t('Sóis de raios abertos'),
  degraus: () => t('Pirâmides em degraus'),
};
export const patternName = (p: { id: string; name: string }) => pick(PATTERN_NAMES, p.id, p.name);
export const patternMood = (p: { id: string; mood: string }) => pick(PATTERN_MOODS, p.id, p.mood);
/** As paletas têm nomes de sítios (Marginal, Índico…): ficam como estão, só o «Néon» muda de grafia. */
const PALETTE_NAMES: Labels<PaletteId> = { neon: () => t('Néon') };
export const paletteName = (p: { id: string; name: string }) => pick(PALETTE_NAMES, p.id, p.name);
const SHAPE_NAMES: Labels<CapulanaShapeId> = {
  coracao: () => t('Coração'),
  estrela: () => t('Estrela'),
  selo: () => t('Selo'),
  losango: () => t('Losango'),
  circulo: () => t('Círculo'),
};
export const shapeName = (s: { id: string; name: string }) => pick(SHAPE_NAMES, s.id, s.name);
