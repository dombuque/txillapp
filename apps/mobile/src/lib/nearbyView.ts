// "À tua volta": textos e regras do ecrã que não dependem do React (distâncias, datas dos eventos, estados vazios,
// mensagens de localização e de erro, e que tipos se pedem ao servidor).
// Sem dependências (os testes correm em Node: tests/nearbyView.test.mjs).

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
 * uma vez e o filtro é feito aqui (trocar de filtro é instantâneo e não gasta pedidos). A única exceção é o "quando" dos
 * eventos: "A decorrer" e "Esta semana" só mudam os eventos, e aí pede-se só os eventos.
 */
export function kindsToFetch(filter: NearbyFilter, when: NearbyWhen): NearbyKind[] {
  return filter === 'events' && when !== 'today' ? ['events'] : ALL_KINDS;
}

/** "a 1,2 km" / "a 300 m" (de 50 em 50 m; 980 m arredonda para "a 1 km", nunca "a 1000 m"). */
export function kmLabel(km: number): string {
  const m = Math.max(50, Math.round((km * 1000) / 50) * 50);
  return m < 1000 ? `a ${m} m` : `a ${Math.max(1, km).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} km`;
}

/** Um evento sem hora de fim conta como "a decorrer" durante 4 horas (a mesma regra do servidor). */
export const DEFAULT_EVENT_HOURS = 4;

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
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
  const head = live ? 'A decorrer' : diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : `${WD[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]}`;
  return `${head} · ${hm(d)}${hasEnd ? ` até ${hm(e!)}` : ''}`;
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
  const widen = wider ? { label: `Ver até ${wider} km`, radius: wider } : undefined;
  const further = wider ? ' Vê um pouco mais longe.' : '';
  switch (o.filter) {
    case 'people':
      if (!o.canEnable) return { title: 'Só a partir dos 18 anos', sub: 'Ver a malta à tua volta (e aparecer-lhe) só é possível a partir dos 18 anos.' };
      return {
        title: 'Ninguém da malta por perto',
        sub: `Só aparece quem ligou "Aparecer em À tua volta", te segue e esteve por aqui nas últimas 3 horas.${further}`,
        action: widen,
      };
    case 'events':
      if (o.when !== 'week') {
        return { title: o.when === 'now' ? 'Nenhum evento a decorrer por perto' : 'Sem eventos hoje por perto', sub: 'Vê o que há nos próximos dias.', action: { label: 'Ver esta semana', when: 'week' } };
      }
      return { title: 'Sem eventos esta semana por perto', sub: `Os locais anunciam aqui os seus eventos.${further}`, action: widen };
    case 'posts':
      return { title: 'Sem publicações por perto', sub: `Aqui aparecem as fotos e os vídeos das últimas 48 horas com sítio marcado.${further}`, action: widen };
    case 'venues':
      return { title: 'Sem locais por perto', sub: wider ? 'Vê um pouco mais longe ou escolhe outro sítio.' : 'Escolhe outro sítio para ver mais locais.', action: widen };
    case 'groups':
      return { title: 'Sem TxillGroups por perto', sub: `Aparecem os grupos abertos (e os que pedem para entrar) com sítio no mapa.${further}`, action: widen };
    default:
      return {
        title: 'Por aqui está calmo',
        sub: wider ? 'Não há nada perto com estes filtros. Vê um pouco mais longe ou troca o filtro.' : 'Troca o filtro ou volta mais logo: há sempre coisas novas.',
        action: widen,
      };
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
        ? { title: 'Localização bloqueada', text: 'Este browser não deixa o Txillapp saber onde estás. Autoriza nas definições do site (o cadeado ao lado do endereço) ou escolhe uma cidade.', settings: false }
        : { title: 'Localização bloqueada', text: 'O Txillapp não tem autorização para usar a localização. Podes autorizar nas definições do telemóvel ou escolher uma cidade.', settings: true };
    case 'off':
      return { title: 'Localização desligada', text: 'Liga a localização do telemóvel e tenta outra vez, ou escolhe uma cidade.', settings: false };
    case 'denied':
      return { title: 'Sem autorização', text: 'Sem autorização não consigo saber onde estás. Podes escolher uma cidade.', settings: false };
    default:
      return { title: 'Sem localização', text: 'Não consegui saber onde estás. Tenta outra vez (de preferência com melhor sinal) ou escolhe uma cidade.', settings: false };
  }
}

/** A explicação do erro ao carregar: sem rede, demasiados pedidos seguidos ou outra coisa. `status` 0/null = sem resposta. */
export function loadErrorText(status: number | null | undefined): string {
  if (!status) return 'Parece que estás sem ligação. Verifica a rede e tenta outra vez.';
  if (status === 429) return 'Foram muitas procuras seguidas. Espera um minuto e tenta outra vez.';
  return 'Algo correu mal do nosso lado. Tenta outra vez daqui a pouco.';
}
