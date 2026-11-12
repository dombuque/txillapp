import { createHash } from 'crypto';
import { MUSIC_MAX_S, MUSIC_MIN_S, SOUND_MAX_S, SOUND_MIN_S, type CatalogTrack, type MusicSourceId, type MusicStyleId, type TrackKind, type TrackLicense } from './track';

/** Onde as faixas podem estar alojadas (o áudio toca na app e no site; o CSP do site lista os mesmos). */
export const ALLOWED_HOSTS = [
  'cdn.freesound.org',
  'freesound.org',
  'mp3d.jamendo.com',
  'prod-1.storage.jamendo.com',
  'storage.jamendo.com',
  'upload.wikimedia.org',
  'files.freemusicarchive.org',
  'freemusicarchive.org',
  'ccmixter.org',
  'cdn.pixabay.com',
  'archive.org',
  'ia800000.us.archive.org',
];

export const hostOk = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

/** Só ligações https (nunca javascript:, data: nem outras): estes endereços viram links e imagens na app. */
export const httpsOnly = (url: string | null | undefined): url is string => {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

/** http → https (as fontes antigas ainda escrevem http nos textos das licenças). */
export const toHttps = (url: string | null | undefined): string | null => {
  if (!url) return null;
  const u = url.trim().replace(/^http:\/\//i, 'https://');
  return httpsOnly(u) ? u : null;
};

/**
 * A licença a partir do endereço (ou do nome) que a fonte dá. Só CC0, domínio público e CC BY servem para pôr num vídeo
 * partilhado; NC, ND e SA (e o resto) devolvem null e a faixa fica de fora.
 */
export function licenseFrom(raw: string | null | undefined): TrackLicense | null {
  const l = (raw ?? '').trim().toLowerCase();
  if (!l) return null;
  if (/publicdomain\/zero|(^|[^a-z])cc0([^a-z0-9]|$)|creative commons 0/.test(l)) return 'cc0';
  if (/publicdomain\/mark|^pdm$|public domain/.test(l)) return 'pdm';
  if (/creativecommons\.org\/licenses\/by\/\d/.test(l)) return 'by';
  if (/^(cc[- ]?)?by$|^attribution( \d(\.\d)?)?$|^attribution \(\d\.\d\)$/.test(l)) return 'by';
  return null;
}

/** Palavras que, no título ou nas etiquetas, denunciam um som solto (loop, sample, efeito) e não uma música. */
const SOUND_WORDS = /\b(loop|loops|sample|samples|sfx|fx|foley|one[- ]?shot|drum ?kit|stem|stems|sound ?effect|efeito|ringtone|jingle|stinger|whoosh|riser|impact)\b/i;
/** Coisas que não são para um mimo: a cappellas, testes, faixas sem nome. */
const JUNK = /\b(a ?cappella|acapella|acappella|test|teste|untitled|sem t[ií]tulo|demo ?\d*$|vocal(s)? only|spoken word|podcast|audiobook|interview|entrevista)\b/i;

/** Um candidato tal como uma fonte o encontra, antes da curadoria. */
export interface Candidate {
  source: Exclude<MusicSourceId, 'local'>;
  sourceId: string;
  title: string;
  artist: string;
  duration: number | null;
  previewUrl: string | null;
  cover: string | null;
  license: string | null;
  landing: string | null;
  tags: string[];
  /** A fonte diz que é um efeito (Freesound). */
  sound?: boolean;
  /** Conteúdo para adultos segundo a fonte. */
  nsfw?: boolean;
  /** Números da fonte (gostos, downloads, avaliações…), guardados para o backoffice. */
  signals: Record<string, number>;
}

/** Os mínimos de cada fonte para uma faixa entrar, e a referência para a nota de qualidade (0..1). */
export const QUALITY_RULES: Record<Candidate['source'], { min: (s: Record<string, number>) => boolean; score: (s: Record<string, number>) => number; label: string }> = {
  ccmixter: {
    label: 'pelo menos 5 recomendações no ccMixter',
    min: (s) => (s.recommendations ?? 0) >= 5,
    score: (s) => logScore(s.recommendations ?? 0, 300) * 0.85 + logScore(s.reviews ?? 0, 30) * 0.15,
  },
  archive: {
    label: 'pelo menos 300 downloads no Internet Archive (coleção netlabels) e nota média ≥ 3 quando há avaliações',
    min: (s) => (s.downloads ?? 0) >= 300 && (!(s.ratings > 0) || (s.rating ?? 0) >= 3),
    score: (s) => logScore(s.downloads ?? 0, 50_000) * 0.8 + (s.ratings > 0 ? ((s.rating ?? 0) / 5) * 0.2 : 0.1),
  },
  jamendo: {
    label: 'pelo menos 1000 audições no Jamendo',
    min: (s) => (s.listens ?? 0) >= 1000,
    score: (s) => logScore(s.listens ?? 0, 1_000_000) * 0.6 + logScore(s.downloads ?? 0, 100_000) * 0.2 + logScore(s.favorited ?? 0, 5_000) * 0.2,
  },
  freesound: {
    label: 'pelo menos 500 downloads e nota ≥ 3,5 (com 3 avaliações) no Freesound',
    min: (s) => (s.downloads ?? 0) >= 500 && (s.ratings ?? 0) >= 3 && (s.rating ?? 0) >= 3.5,
    score: (s) => logScore(s.downloads ?? 0, 200_000) * 0.7 + ((s.rating ?? 0) / 5) * 0.3,
  },
};

function logScore(v: number, ref: number) {
  if (!(v > 0)) return 0;
  return Math.min(1, Math.log10(1 + v) / Math.log10(1 + ref));
}

export interface Curated {
  track: CatalogTrack;
  quality: number;
  signals: Record<string, number>;
}

/** Id curto e estável dentro dos 80 caracteres (o Archive tem identificadores compridos). */
export const shortId = (s: string) => (s.length <= 60 && /^[\w.\-]+$/.test(s) ? s : createHash('sha1').update(s).digest('hex').slice(0, 24));

/** Porque é que um candidato não entrou (para os registos e os testes); null = entrou. */
export function rejectReason(c: Candidate): string | null {
  if (!c.previewUrl || !hostOk(c.previewUrl)) return 'sem pré-visualização';
  if (!licenseFrom(c.license)) return 'licença';
  if (c.nsfw) return 'adultos';
  if (!c.title.trim()) return 'sem título';
  if (JUNK.test(c.title) || c.tags.some((t) => JUNK.test(t))) return 'baixa qualidade';
  const kind = kindOf(c);
  const d = c.duration ?? 0;
  if (kind === 'music' && (d < MUSIC_MIN_S || d > MUSIC_MAX_S)) return 'duração';
  if (kind === 'sound' && (d < SOUND_MIN_S || d > SOUND_MAX_S)) return 'duração';
  if (!QUALITY_RULES[c.source].min(c.signals)) return 'sinais de qualidade';
  return null;
}

/**
 * Música ou som: os efeitos da fonte e os loops/samples vão para «Sons» (e aí só ficam os curtos). Uma música curtíssima de uma
 * fonte de música não vira som: fica de fora pela duração.
 */
export function kindOf(c: Candidate): TrackKind {
  if (c.sound) return 'sound';
  if (SOUND_WORDS.test(c.title) || c.tags.some((t) => SOUND_WORDS.test(t))) return 'sound';
  return 'music';
}

/** Curadoria de um candidato: null se não serve. `style` é o estilo da pesquisa que o encontrou. */
export function curate(c: Candidate, styles: MusicStyleId[]): Curated | null {
  if (rejectReason(c)) return null;
  const kind = kindOf(c);
  const track: CatalogTrack = {
    id: `${c.source}:${shortId(c.sourceId)}`,
    title: clean(c.title, 120) || 'Sem título',
    artist: clean(c.artist, 120),
    duration: Math.round(c.duration ?? 0),
    previewUrl: c.previewUrl!,
    cover: toHttps(c.cover),
    source: c.source,
    license: licenseFrom(c.license)!,
    licenseUrl: licenseUrlOf(c.license),
    landing: toHttps(c.landing),
    styles: kind === 'sound' ? [] : [...new Set(styles)],
    kind,
  };
  return { track, quality: Math.round(QUALITY_RULES[c.source].score(c.signals) * 1000) / 1000, signals: c.signals };
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function licenseUrlOf(raw: string | null): string | null {
  const u = toHttps(raw);
  if (u) return u;
  const l = licenseFrom(raw);
  if (l === 'cc0') return 'https://creativecommons.org/publicdomain/zero/1.0/';
  if (l === 'pdm') return 'https://creativecommons.org/publicdomain/mark/1.0/';
  if (l === 'by') return 'https://creativecommons.org/licenses/by/4.0/';
  return null;
}

/** Texto para pesquisar: minúsculas e sem acentos. */
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
