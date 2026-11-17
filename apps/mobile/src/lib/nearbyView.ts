// "À tua volta": textos e regras do ecrã que não dependem do React (distâncias, datas dos eventos, estados vazios,
// mensagens de localização e de erro, e que tipos se pedem ao servidor).
// Sem dependências (os testes correm em Node: tests/nearbyView.test.mjs).

import { intlLocale, monthNames, t, weekdayNames } from '@/lib/i18n';
export type NearbyKind = 'venues' | 'events' | 'posts' | 'groups' | 'people';
export type NearbyWhen = 'now' | 'today' | 'week';
export type NearbyFilter = 'all' | 'venues' | 'events' | 'people' | 'posts' | 'groups';
/** O tipo de cada item na lista e no mapa. */
export type NearbyItemKind = 'venue' | 'event' | 'post' | 'group' | 'person';

export const ALL_KINDS: NearbyKind[] = ['venues', 'events', 'posts', 'groups', 'people'];
const ITEM_KIND: Record<NearbyKind, NearbyItemKind> = { venues: 'venue', events: 'event', posts: 'post', groups: 'group', people: 'person' };
const FILTER_KINDS: Record<NearbyFilter, NearbyKind[]> = {
  all: ALL_KINDS,
  venues: ['venues'],
  events: ['events'],
  people: ['people'],
  posts: ['posts'],
  groups: ['groups'],
};

/** O que cada filtro mostra (tipos dos itens). */
export function shownKinds(filter: NearbyFilter): Set<NearbyItemKind> {
  return new Set(FILTER_KINDS[filter].map((k) => ITEM_KIND[k]));
}

/**
 * O que se pede ao servidor. O servidor tem o mesmo limite por tipo com ou sem os outros tipos, por isso pede-se tudo de
 * uma vez (com os eventos da semana) e o filtro é feito aqui (trocar de filtro é instantâneo e não gasta pedidos).
 * A única exceção é o "quando" dos eventos: "Hoje" e "A decorrer" só mudam os eventos, e aí pede-se só os eventos.
 */
export function kindsToFetch(filter: NearbyFilter, when: NearbyWhen): NearbyKind[] {
  return filter === 'events' && when !== 'week' ? ['events'] : ALL_KINDS;
}

/**
 * O "quando" que se pede: só o filtro "Eventos" escolhe (Hoje, A decorrer, Esta semana). "Tudo" e os outros filtros
 * pedem os eventos da semana, como o servidor faz por omissão.
 */
export function whenToFetch(filter: NearbyFilter, when: NearbyWhen): NearbyWhen {
  return filter === 'events' ? when : 'week';
}

/**
 * Ao terminar sessão: tira a minha presença do mapa (`clear` = DELETE /nearby/presence) sem prender a saída.
 * Nunca falha e espera no máximo `ms` (sem rede, a presença expira sozinha ao fim de 3 horas).
 */
export async function clearOnSignOut(clear: () => Promise<unknown>, ms = 2500): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(clear).then(() => undefined, () => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** "a 1,2 km" / "a 300 m" (de 50 em 50 m; 980 m arredonda para "a 1 km", nunca "a 1000 m"). */
export function kmLabel(km: number): string {
  const m = Math.max(50, Math.round((km * 1000) / 50) * 50);
  return m < 1000 ? t('a {m} m', { m }) : t('a {km} km', { km: Math.max(1, km).toLocaleString(intlLocale(), { maximumFractionDigits: 1 }) });
}

/** Um evento sem hora de fim conta como "a decorrer" durante 4 horas (a mesma regra do servidor). */
export const DEFAULT_EVENT_HOURS = 4;

const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** "Hoje · 21:00", "Amanhã · 18:30", "sáb, 14 nov · 22:00", "A decorrer · 21:00 até 23:00". */
export function eventWhen(startsAt: string, endsAt?: string | null, now: Date = new Date()): string {
  const d = new Date(startsAt);
  if (isNaN(d.getTime())) return '';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  const e = endsAt ? new Date(endsAt) : null;
  const hasEnd = !!e && !isNaN(e.getTime());
  const end = hasEnd ? e!.getTime() : d.getTime() + DEFAULT_EVENT_HOURS * 3_600_000;
  const live = d.getTime() <= now.getTime() && now.getTime() <= end;
  const head = live ? t('A decorrer') : diff === 0 ? t('Hoje') : diff === 1 ? t('Amanhã') : `${weekdayNames()[d.getDay()]}, ${d.getDate()} ${monthNames('short')[d.getMonth()]}`;
  return `${head} · ${hm(d)}${hasEnd ? (' ' + t('até {hm}', { hm: hm(e!) })) : ''}`;
}

export interface EmptyHint {
  title: string;
  sub: string;
  /** Um botão que resolve: ver mais longe ou ver a semana toda. */
  action?: { label: string; radius?: number; when?: NearbyWhen };
}

/** O que dizer quando a lista vem vazia, conforme o filtro (nada de "está calmo" quando a razão é outra). */
export function emptyHint(o: { filter: NearbyFilter; when: NearbyWhen; radius: number; radii: readonly number[]; canEnable: boolean }): EmptyHint {
  const wider = o.radii.find((r) => r > o.radius);
  const widen = wider ? { label: t('Ver até {wider} km', { wider }), radius: wider } : undefined;
  const further = wider ? (' ' + t('Vê um pouco mais longe.')) : '';
  switch (o.filter) {
    case 'people':
      if (!o.canEnable) return { title: t('Só a partir dos 18 anos'), sub: t('Ver a malta à tua volta (e aparecer-lhe) só é possível a partir dos 18 anos.') };
      return {
        title: t('Ninguém da malta por perto'),
        sub: t('Só aparece quem ligou "Aparecer em À tua volta", te segue e esteve por aqui nas últimas 3 horas.{further}', { further }),
        action: widen,
      };
    case 'events':
      if (o.when !== 'week') {
        return { title: o.when === 'now' ? t('Nenhum evento a decorrer por perto') : t('Sem eventos hoje por perto'), sub: t('Vê o que há nos próximos dias.'), action: { label: t('Ver esta semana'), when: 'week' } };
      }
      return { title: t('Sem eventos esta semana por perto'), sub: t('Os locais anunciam aqui os seus eventos.{further}', { further }), action: widen };
    case 'posts':
      return { title: t('Sem publicações por perto'), sub: t('Aqui aparecem as fotos e os vídeos das últimas 48 horas com sítio marcado.{further}', { further }), action: widen };
    case 'venues':
      return { title: t('Sem locais por perto'), sub: wider ? t('Vê um pouco mais longe ou escolhe outro sítio.') : t('Escolhe outro sítio para ver mais locais.'), action: widen };
    case 'groups':
      return { title: t('Sem TxillGroups por perto'), sub: t('Aparecem os grupos abertos (e os que pedem para entrar) com sítio no mapa.{further}', { further }), action: widen };
    default:
      // "Tudo" já traz os eventos da semana inteira (não só os de hoje).
      return {
        title: t('Por aqui está calmo'),
        sub: t('Nada num raio de {radius} km, nem eventos esta semana.{value}', { radius: o.radius, value: wider ? '' : (' ' + t('Volta mais logo: há sempre coisas novas.')) }),
        action: widen,
      };
  }
}

/** Os outros caminhos do estado vazio (além do botão principal do emptyHint). */
export type EmptyExtra = 'place' | 'invite' | 'venue' | 'all';
export const EMPTY_EXTRA_LABEL: Record<EmptyExtra, string> = { place: 'Mudar o sítio', get invite() { return t('Convidar a malta'); }, venue: 'Tenho um local', get all() { return t('Ver tudo'); } };

/**
 * No máximo dois caminhos a mais no vazio, conforme o filtro: mudar o sítio, convidar a malta (para haver quem apareça),
 * registar o local (os eventos e os locais vêm das páginas dos locais) ou voltar a «Tudo». Menores de 18 não veem a malta:
 * no filtro da malta só lhes fica «Ver tudo».
 */
export function emptyExtras(o: { filter: NearbyFilter; canEnable: boolean }): EmptyExtra[] {
  switch (o.filter) {
    case 'all':
      return ['place', 'invite'];
    case 'people':
      return o.canEnable ? ['invite', 'all'] : ['all'];
    case 'events':
      return ['all', 'venue'];
    case 'venues':
      return ['place', 'venue'];
    default:
      return ['all', 'place'];
  }
}

/** Porque é que não deu para usar a localização. */
export type LocateProblem = 'denied' | 'blocked' | 'off' | 'failed';

/**
 * O texto para cada problema e se vale a pena oferecer "Abrir definições" (só na app; no browser não há como).
 * No browser, um "não" à pergunta fica gravado no site: recusado e bloqueado dão o mesmo conselho.
 */
export function locateProblemText(p: LocateProblem, web: boolean): { title: string; text: string; settings: boolean } {
  switch (web && p === 'denied' ? 'blocked' : p) {
    case 'blocked':
      return web
        ? { title: t('Localização bloqueada'), text: t('Este browser não deixa o Txillapp saber onde estás. Autoriza nas definições do site (o cadeado ao lado do endereço) ou escolhe uma cidade.'), settings: false }
        : { title: t('Localização bloqueada'), text: t('O Txillapp não tem autorização para usar a localização. Podes autorizar nas definições do telemóvel ou escolher uma cidade.'), settings: true };
    case 'off':
      return { title: t('Localização desligada'), text: t('Liga a localização do telemóvel e tenta outra vez, ou escolhe uma cidade.'), settings: false };
    case 'denied':
      return { title: t('Sem autorização'), text: t('Sem autorização não consigo saber onde estás. Podes escolher uma cidade.'), settings: false };
    default:
      return { title: t('Sem localização'), text: t('Não consegui saber onde estás. Tenta outra vez (de preferência com melhor sinal) ou escolhe uma cidade.'), settings: false };
  }
}

/** A explicação do erro ao carregar: sem rede, demasiados pedidos seguidos ou outra coisa. `status` 0/null = sem resposta. */
export function loadErrorText(status: number | null | undefined): string {
  if (!status) return t('Parece que estás sem ligação. Verifica a rede e tenta outra vez.');
  if (status === 429) return t('Foram muitas procuras seguidas. Espera um minuto e tenta outra vez.');
  return t('Algo correu mal do nosso lado. Tenta outra vez daqui a pouco.');
}
