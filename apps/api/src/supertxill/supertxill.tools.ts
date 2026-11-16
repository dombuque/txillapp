import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { GeleiraService } from '../geleira/geleira.service';
import { coarse } from '../nearby/geo-sql';
import { NearbyService } from '../nearby/nearby.service';
import { canView } from '../social/visibility';
import { TxilladaService } from '../txillada/txillada.service';
import { VenuesService } from '../venues/venues.service';
import type { OllamaTool } from './ollama';

/** Onde a pessoa está, aproximado (~1 km): a última posição que partilhou no «À tua volta» ou a cidade do perfil. */
export interface Where {
  lat: number;
  lng: number;
  /** Para o modelo: de onde vem (nunca coordenadas). */
  label: string;
}

/** Centros aproximados das cidades de Moçambique, para quem não partilhou a posição e não há locais da cidade no mapa. */
const CITIES: Record<string, [number, number]> = {
  maputo: [-25.97, 32.57],
  matola: [-25.96, 32.46],
  beira: [-19.84, 34.84],
  nampula: [-15.12, 39.27],
  quelimane: [-17.88, 36.89],
  tete: [-16.16, 33.59],
  'xai-xai': [-25.05, 33.64],
  inhambane: [-23.87, 35.38],
  pemba: [-12.97, 40.52],
  lichinga: [-13.31, 35.24],
  chimoio: [-19.12, 33.48],
  nacala: [-14.56, 40.69],
  maxixe: [-23.86, 35.35],
  gurue: [-15.46, 36.98],
  dondo: [-19.61, 34.74],
  vilankulo: [-22.0, 35.31],
  ponta: [-26.84, 32.88],
};
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

const RADIUS = { min: 1, max: 30, default: 10 } as const;
const VENUE_KINDS = ['bar', 'restaurante', 'discoteca', 'cafe', 'hotel', 'evento', 'outro'];
const radius = (v: unknown, def: number = RADIUS.default) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(RADIUS.max, Math.max(RADIUS.min, n)) : def;
};
const str = (v: unknown, max = 60) => (typeof v === 'string' ? v.trim().replace(/^@/, '').slice(0, max) : '');
const hm = (iso: string) =>
  new Date(iso).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export interface ToolGuess {
  name: string;
  args: Record<string, unknown>;
}

/**
 * As ferramentas que a pergunta pede de certeza, por palavras (no máximo 2). A API corre-as antes de perguntar ao modelo e
 * entrega-lhe já os resultados: os modelos pequenos às vezes esquecem-se de as chamar (e inventam), e em CPU poupa-se uma
 * volta inteira. Nunca em pedidos para localizar alguém às escondidas (bloqueios, ex, espiar…): aí o modelo recusa sozinho.
 */
export function guessTools(text: string): ToolGuess[] {
  const t = ` ${norm(text)} `;
  if (/\b(bloque|ex\b|espia|vigia|persegu|descobr|localiz|rastre|escondid|morada|onde (ela|ele) (mora|vive|esta))/.test(t)) return [];
  // Pedidos de escrita (legendas, bios…) não precisam de dados da app, mesmo que falem de amigos ou de um bar.
  if (/\b(legendas?|bio|nota|escreve|escrever|texto|frase|poema|mensagem)\b/.test(t)) return [];
  const out: ToolGuess[] = [];
  const add = (name: string, args: Record<string, unknown> = {}) => out.length < 2 && !out.some((o) => o.name === name) && out.push({ name, args });
  const forYou = /\b(quem seguir|malta para ti|gente nova|pessoas novas|sugere(s)? (pessoas|malta|amigos))\b/.test(t);
  if (forYou) add('malta_para_ti');
  if (!forYou && /\b((a |minha |nossa )malta|meus amigos|minhas amigas|amigos|amigas|galera|quem (esta|anda) (por )?(perto|aqui))\b/.test(t) && !/\b(curte|gosta|gostos)\b/.test(t)) add('malta_perto');
  if (/\b(txilladas?|lives?|ao vivo|em direto)\b/.test(t)) add('txilladas_agora');
  if (/\b(eventos?|festas?|concertos?|shows?|hoje a noite|esta noite|fim de semana)\b/.test(t)) add('eventos_perto', { quando: /\b(agora|ja)\b/.test(t) ? 'agora' : /\b(semana|fim de semana)\b/.test(t) ? 'semana' : 'hoje' });
  const kind = /\bcafes?\b|\bcafezinho\b/.test(t) ? 'cafe' : /\b(restaurantes?|comer|jantar|almocar)\b/.test(t) ? 'restaurante' : /\b(discotecas?|dancar|balada)\b/.test(t) ? 'discoteca' : /\b(bares?|beber|uma gelada|cerveja)\b/.test(t) ? 'bar' : null;
  if (kind) add('sitios_perto', { tipo: kind });
  else if (/\b(sitios?|lugares?|onde (ir|sair)|sair hoje)\b/.test(t)) add('sitios_perto');
  if (/\b(o que|que) a malta (curte|gosta)\b/.test(t)) add('geleira_amigos');
  else if (/\b(a minha geleira|os meus gostos|o que (eu )?curto)\b/.test(t)) add('geleira');
  // Humor sem pedido claro ("estou animado, o que faço?"): a malta perto e sítios.
  if (!out.length && /\b(animad|cansad|aborrecid|entediad|em baixo|triste|feliz|de boa)\w*/.test(t) && /\b(onde|o que (faco|fazer)|sugere|sugestoes?|plano|programa|ideias?)\b/.test(t)) {
    add('malta_perto');
    add('sitios_perto');
  }
  return out;
}

const NO_PLACE = {
  erro: 'sem_localizacao',
  dica: 'Não sei onde estás: liga «Aparecer no mapa» no «À tua volta» ou põe a tua cidade no perfil. Não peças coordenadas.',
};

/** As ferramentas que o modelo pode pedir (formato do Ollama). Descrições curtas: os modelos pequenos leem tudo. */
export const TOOLS: OllamaTool[] = [
  {
    type: 'function',
    function: {
      name: 'malta_perto',
      description: 'Amigos que estão perto agora (do «À tua volta»): só quem aceitou aparecer no mapa e me deixa ver. Dá o sítio aproximado e há quanto tempo. Usa para "onde está a malta", "quem está perto", planos com amigos.',
      parameters: { type: 'object', properties: { raio_km: { type: 'number', description: 'Raio em km (1 a 30). Por omissão 10.' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sitios_perto',
      description: 'Locais perto (bares, restaurantes, discotecas, cafés, hotéis) com quantos check-ins tiveram hoje. Usa para "onde ir", "sítio movimentado", "um café calmo".',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: VENUE_KINDS, description: 'Tipo de local (opcional).' },
          raio_km: { type: 'number', description: 'Raio em km (1 a 30). Por omissão 10.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'eventos_perto',
      description: 'Eventos nos locais perto: a decorrer agora, hoje ou esta semana, com quantos interessados.',
      parameters: {
        type: 'object',
        properties: {
          quando: { type: 'string', enum: ['agora', 'hoje', 'semana'], description: 'Por omissão: hoje.' },
          raio_km: { type: 'number', description: 'Raio em km (1 a 30). Por omissão 15.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'procurar_local',
      description: 'Procura um local do Txillapp pelo nome ou pela cidade (morada, horário, check-ins de hoje).',
      parameters: { type: 'object', properties: { nome: { type: 'string', description: 'Nome do local ou cidade.' } }, required: ['nome'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'txilladas_agora',
      description: 'Txilladas (lives) a decorrer agora que eu posso ver: primeiro de quem sigo.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'geleira',
      description: 'Gostos da geleira (bebidas, comidas, vibes, sítios). Sem username: a minha. Com username: a de outra pessoa, se ela me deixa ver.',
      parameters: { type: 'object', properties: { username: { type: 'string', description: 'O @ da pessoa (opcional).' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'geleira_amigos',
      description: 'Os gostos favoritos da malta que eu sigo e me deixa ver a geleira. Usa para planos em grupo ("o que a malta curte").',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'malta_para_ti',
      description: 'Pessoas sugeridas para eu seguir («Malta para ti»), com o motivo.',
      parameters: { type: 'object', properties: {} },
    },
  },
];
export const TOOL_NAMES = new Set(TOOLS.map((t) => t.function.name));

/**
 * As ferramentas do SuperTxill: correm na API, junto à base de dados, como a pessoa que pergunta, e só com o que ela já
 * pode ver na app (reutilizam os serviços e as consultas do «À tua volta», dos locais, das Txilladas e da geleira, com as
 * mesmas regras de visibilidade, bloqueios e contas privadas). Nunca devolvem coordenadas: só nomes de sítios e distâncias.
 */
@Injectable()
export class SuperTxillTools {
  private readonly log = new Logger('SuperTxillTools');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly nearby: NearbyService,
    private readonly venues: VenuesService,
    private readonly txillada: TxilladaService,
    private readonly geleira: GeleiraService,
  ) {}

  /**
   * Onde a pessoa está: a quadrícula que partilhou no «À tua volta» nas últimas 3 horas; senão o centro da cidade do perfil
   * (pelos locais aprovados dessa cidade ou por uma tabela das cidades de Moçambique). Nunca se pede o GPS.
   */
  async where(userId: string): Promise<Where | null> {
    const pr = (await this.pool.query(`SELECT cell_lat, cell_lng FROM nearby.presence WHERE user_id = $1 AND updated_at > now() - interval '3 hours'`, [userId])).rows[0];
    if (pr) {
      const c = { lat: coarse(Number(pr.cell_lat)), lng: coarse(Number(pr.cell_lng)) };
      const near = await this.placeNames(userId, [c]);
      return { ...c, label: `pela tua última posição no «À tua volta»${near[0] ? `, perto de ${near[0]}` : ''}` };
    }
    const u = (await this.pool.query('SELECT city FROM identity.users WHERE id = $1', [userId])).rows[0];
    const city = typeof u?.city === 'string' ? u.city.trim() : '';
    if (!city) return null;
    const avg = (
      await this.pool.query(
        `SELECT avg(v.lat)::float8 AS lat, avg(v.lng)::float8 AS lng FROM content.venues v
          WHERE v.review_status = 'approved' AND v.show_on_map AND v.lat IS NOT NULL AND v.lng IS NOT NULL AND lower(trim(v.city)) = lower($2)
            AND (v.country IS NULL OR v.country IS NOT DISTINCT FROM (SELECT country FROM identity.users WHERE id = $1))`,
        [userId, city],
      )
    ).rows[0];
    const known = CITIES[norm(city)] ?? CITIES[norm(city).split(/[\s,]+/)[0]];
    const at = avg?.lat != null ? { lat: Number(avg.lat), lng: Number(avg.lng) } : known ? { lat: known[0], lng: known[1] } : null;
    if (!at) return null;
    return { lat: coarse(at.lat), lng: coarse(at.lng), label: `pela cidade do teu perfil (${city})` };
  }

  /**
   * O nome do local no mapa mais perto de cada ponto (até ~1,5 km), para dizer "perto de X" em vez de coordenadas.
   * Só locais aprovados, no mapa, do país de quem pergunta e de contas ativas (as mesmas regras dos pinos do mapa).
   */
  private async placeNames(userId: string, pts: { lat: number; lng: number }[]): Promise<(string | null)[]> {
    if (!pts.length) return [];
    const { rows } = await this.pool.query(
      `SELECT p.i, (SELECT v.name FROM content.venues v
                     WHERE v.review_status = 'approved' AND v.show_on_map AND v.lat IS NOT NULL AND v.lng IS NOT NULL
                       AND abs(v.lat - p.lat) < 0.014 AND abs(v.lng - p.lng) < 0.016
                       AND (v.country IS NULL OR v.country IS NOT DISTINCT FROM (SELECT country FROM identity.users WHERE id = $1))
                       AND EXISTS (SELECT 1 FROM identity.users ou WHERE ou.id = v.owner_id AND ou.status <> 'deleted')
                     ORDER BY (v.lat - p.lat) ^ 2 + (v.lng - p.lng) ^ 2, v.verified DESC LIMIT 1) AS name
         FROM unnest($2::float8[], $3::float8[]) WITH ORDINALITY AS p(lat, lng, i) ORDER BY p.i`,
      [userId, pts.map((p) => p.lat), pts.map((p) => p.lng)],
    );
    return rows.map((r) => (r.name as string | null) ?? null);
  }

  /** Corre uma ferramenta pedida pelo modelo. Nunca rebenta: um erro vira `{ erro }` para o modelo explicar. */
  async run(userId: string, name: string, args: Record<string, unknown>, extra: { forYou: (userId: string) => Promise<unknown[]> }): Promise<unknown> {
    try {
      switch (name) {
        case 'malta_perto':
          return await this.maltaPerto(userId, radius(args.raio_km));
        case 'sitios_perto':
          return await this.sitiosPerto(userId, radius(args.raio_km), str(args.tipo, 20).toLowerCase());
        case 'eventos_perto':
          return await this.eventosPerto(userId, radius(args.raio_km, 15), str(args.quando, 10).toLowerCase());
        case 'procurar_local':
          return await this.procurarLocal(userId, str(args.nome));
        case 'txilladas_agora':
          return await this.txilladas(userId);
        case 'geleira':
          return await this.geleiraDe(userId, str(args.username, 40));
        case 'geleira_amigos':
          return await this.geleiraAmigos(userId);
        case 'malta_para_ti': {
          const list = (await extra.forYou(userId)) as { username: string; displayName: string; reason: string; isPrivate: boolean }[];
          return { pessoas: list.slice(0, 8).map((p) => ({ nome: p.displayName, username: p.username, motivo: p.reason, contaPrivada: p.isPrivate })) };
        }
        default:
          return { erro: 'ferramenta_desconhecida' };
      }
    } catch (e) {
      if (e instanceof NotFoundException) return { erro: 'nao_encontrado' };
      this.log.warn(`ferramenta ${name} falhou: ${(e as Error).message}`);
      return { erro: 'falhou' };
    }
  }

  private async maltaPerto(userId: string, km: number) {
    const at = await this.where(userId);
    if (!at) return NO_PLACE;
    const { people } = await this.nearby.forAssistant(userId, at, km, 'people');
    const list = people.slice(0, 12);
    const near = await this.placeNames(userId, list.map((p) => ({ lat: p.lat, lng: p.lng })));
    return {
      centro: at.label,
      raioKm: km,
      malta: list.map((p, i) => ({ nome: p.displayName, username: p.username, distanciaKm: p.approxKm, vistoNoMapa: p.ago, ...(near[i] ? { pertoDe: near[i] } : {}) })),
      ...(people.length ? {} : { nota: 'Ninguém da tua malta está a aparecer no mapa por aqui agora.' }),
    };
  }

  private async sitiosPerto(userId: string, km: number, tipo: string) {
    const at = await this.where(userId);
    if (!at) return NO_PLACE;
    const { venues } = await this.nearby.forAssistant(userId, at, km, 'venues');
    const list = venues.filter((v) => !VENUE_KINDS.includes(tipo) || v.kind === tipo).slice(0, 10);
    return {
      centro: at.label,
      raioKm: km,
      locais: list.map((v) => ({ nome: v.name, tipo: v.kind, distanciaKm: v.distanceKm, checkinsHoje: v.checkinsToday, seguidores: v.followers, verificado: v.verified })),
    };
  }

  private async eventosPerto(userId: string, km: number, quando: string) {
    const at = await this.where(userId);
    if (!at) return NO_PLACE;
    const when = quando === 'agora' ? 'now' : quando === 'semana' ? 'week' : 'today';
    const { events } = await this.nearby.forAssistant(userId, at, km, 'events', when);
    return {
      centro: at.label,
      raioKm: km,
      eventos: events.slice(0, 10).map((e) => ({ titulo: e.title, local: e.venue.name, comeca: hm(e.startsAt), ...(e.endsAt ? { acaba: hm(e.endsAt) } : {}), distanciaKm: e.distanceKm, interessados: e.interested })),
    };
  }

  private async procurarLocal(userId: string, nome: string) {
    if (nome.length < 2) return { erro: 'nome_curto' };
    const list = await this.venues.search(userId, nome, 5);
    return {
      locais: list.map((v) => ({ nome: v.name, tipo: v.kind, cidade: v.city, morada: v.address, horario: v.hours, checkinsHoje: v.checkinsToday, verificado: v.verified, ...(v.about ? { sobre: v.about.slice(0, 160) } : {}) })),
    };
  }

  private async txilladas(userId: string) {
    const { items } = await this.txillada.live(userId);
    return {
      txilladas: items.slice(0, 8).map((t) => ({ titulo: t.title, anfitriao: t.host.displayName, username: t.host.username, aVer: t.viewers, privadaPreco: t.kind === 'paid' ? t.price : null, desdeMin: Math.max(0, Math.round((Date.now() - new Date(t.startedAt).getTime()) / 60_000)) })),
    };
  }

  private async geleiraDe(userId: string, username: string) {
    const items = username ? await this.geleira.of(userId, username) : await this.geleira.mine(userId);
    return {
      de: username ? `@${username}` : 'tu',
      itens: items.slice(0, 15).map((i) => ({ nome: i.name, tipo: i.kind, categoria: i.category, ...(i.favorite ? { favorito: true } : {}), ...(i.rating ? { nota: i.rating } : {}) })),
    };
  }

  /**
   * A malta que sigo (seguidores mútuos primeiro, os mais recentes), no máximo 8 contas que eu posso ver, e de cada uma
   * os gostos que a geleira dela me deixa ver (a mesma regra de GET /geleira/:username).
   */
  private async geleiraAmigos(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT u.username, u.display_name FROM social.follows f JOIN identity.users u ON u.id = f.followee_id
        WHERE f.follower_id = $1 AND ${canView('u', '$1')}
        ORDER BY EXISTS (SELECT 1 FROM social.follows b WHERE b.follower_id = u.id AND b.followee_id = $1) DESC, f.created_at DESC LIMIT 8`,
      [userId],
    );
    const out: { nome: string; username: string; gostos: string[] }[] = [];
    for (const r of rows) {
      const items = await this.geleira.of(userId, r.username as string).catch(() => []);
      if (items.length) out.push({ nome: r.display_name as string, username: r.username as string, gostos: items.slice(0, 5).map((i) => i.name) });
    }
    return { malta: out, ...(out.length ? {} : { nota: 'Ninguém da malta que segues tem a geleira à tua vista.' }) };
  }
}
