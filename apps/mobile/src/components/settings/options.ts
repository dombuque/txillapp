import type { CallsWho, Gender, Viewers, Who } from '@/lib/api';
import type { NearbyVisibility } from '@/lib/api.nearby';
import { t } from '@/lib/i18n';

/** As escolhas das folhas das Definições (as mesmas de sempre, só mudaram de ficheiro). */
export const VIEWERS: { value: Viewers; title: string; text: string }[] = [
  { value: 'everyone', get title() { return t('Todos'); }, get text() { return t('Qualquer pessoa que veja a publicação.'); } },
  { value: 'followers', get title() { return t('Só os meus seguidores'); }, get text() { return t('Quem me segue.'); } },
  { value: 'off', get title() { return t('Só eu'); }, get text() { return t('Mais ninguém vê os nomes.'); } },
];
export const viewersLabel = (v: Viewers) => VIEWERS.find((x) => x.value === v)!.title;
export const WHO: { value: Who; title: string; text: string }[] = [
  { value: 'everyone', get title() { return t('Todos'); }, get text() { return t('Qualquer pessoa.'); } },
  { value: 'following', get title() { return t('Quem eu sigo'); }, get text() { return t('Só as pessoas que segues.'); } },
  { value: 'off', get title() { return t('Ninguém'); }, get text() { return t('Desativado.'); } },
];
export const whoLabel = (w: Who) => WHO.find((o) => o.value === w)!.title;
export const CALLS: { value: CallsWho; title: string; text: string }[] = [
  { value: 'everyone', get title() { return t('Todos'); }, get text() { return t('Qualquer pessoa te pode ligar.'); } },
  { value: 'following', get title() { return t('Quem eu sigo'); }, get text() { return t('Só as pessoas que segues.'); } },
  { value: 'mutual', get title() { return t('Amigos mútuos'); }, get text() { return t('Só quem segues e te segue de volta. É a opção de origem.'); } },
  { value: 'off', get title() { return t('Ninguém'); }, get text() { return t('Ninguém te liga pelo Txillapp.'); } },
];
export const callsLabel = (w: CallsWho) => CALLS.find((o) => o.value === w)?.title ?? t('Amigos mútuos');
// Os mesmos três níveis do mapa "À tua volta" (perto.tsx).
export const NEARBY: { value: NearbyVisibility; title: string; text: string }[] = [
  { value: 'off', get title() { return t('Ninguém'); }, get text() { return t('Ficas invisível. Vês na mesma o que há à volta.'); } },
  { value: 'mutual', get title() { return t('Amigos mútuos'); }, get text() { return t('Só quem segues e te segue de volta.'); } },
  { value: 'following', get title() { return t('Quem eu sigo'); }, get text() { return t('As pessoas que tu segues.'); } },
];
export const nearbyLabel = (v: NearbyVisibility) => NEARBY.find((o) => o.value === v)?.title ?? t('Ninguém');
export const CONNECTIONS = [
  { value: 'everyone', get title() { return t('Todos'); }, get text() { return t('Qualquer pessoa que veja o teu perfil.'); } },
  { value: 'followers', get title() { return t('Só seguidores'); }, get text() { return t('Quem te segue.'); } },
  { value: 'me', get title() { return t('Só eu'); }, get text() { return t('Ninguém mais vê estas listas.'); } },
] as const;
export const GENDERS: { value: Gender; label: string }[] = [{ value: 'female', get label() { return t('Feminino'); } }, { value: 'male', get label() { return t('Masculino'); } }];
export const genderLabel = (g: Gender) => GENDERS.find((x) => x.value === g)?.label ?? (g === 'other' ? t('Outro') : g === 'unspecified' ? t('Prefiro não dizer') : '');
