import type { CallsWho, Gender, Viewers, Who } from '@/lib/api';
import type { NearbyVisibility } from '@/lib/api.nearby';

/** As escolhas das folhas das Definições (as mesmas de sempre, só mudaram de ficheiro). */
export const VIEWERS: { value: Viewers; title: string; text: string }[] = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa que veja a publicação.' },
  { value: 'followers', title: 'Só os meus seguidores', text: 'Quem me segue.' },
  { value: 'off', title: 'Só eu', text: 'Mais ninguém vê os nomes.' },
];
export const viewersLabel = (v: Viewers) => VIEWERS.find((x) => x.value === v)!.title;
export const WHO: { value: Who; title: string; text: string }[] = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa.' },
  { value: 'following', title: 'Quem eu sigo', text: 'Só as pessoas que segues.' },
  { value: 'off', title: 'Ninguém', text: 'Desativado.' },
];
export const whoLabel = (w: Who) => WHO.find((o) => o.value === w)!.title;
export const CALLS: { value: CallsWho; title: string; text: string }[] = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa te pode ligar.' },
  { value: 'following', title: 'Quem eu sigo', text: 'Só as pessoas que segues.' },
  { value: 'mutual', title: 'Amigos mútuos', text: 'Só quem segues e te segue de volta. É a opção de origem.' },
  { value: 'off', title: 'Ninguém', text: 'Ninguém te liga pelo Txillapp.' },
];
export const callsLabel = (w: CallsWho) => CALLS.find((o) => o.value === w)?.title ?? 'Amigos mútuos';
// Os mesmos três níveis do mapa "À tua volta" (perto.tsx).
export const NEARBY: { value: NearbyVisibility; title: string; text: string }[] = [
  { value: 'off', title: 'Ninguém', text: 'Ficas invisível. Vês na mesma o que há à volta.' },
  { value: 'mutual', title: 'Amigos mútuos', text: 'Só quem segues e te segue de volta.' },
  { value: 'following', title: 'Quem eu sigo', text: 'As pessoas que tu segues.' },
];
export const nearbyLabel = (v: NearbyVisibility) => NEARBY.find((o) => o.value === v)?.title ?? 'Ninguém';
export const CONNECTIONS = [
  { value: 'everyone', title: 'Todos', text: 'Qualquer pessoa que veja o teu perfil.' },
  { value: 'followers', title: 'Só seguidores', text: 'Quem te segue.' },
  { value: 'me', title: 'Só eu', text: 'Ninguém mais vê estas listas.' },
] as const;
export const GENDERS: { value: Gender; label: string }[] = [{ value: 'female', label: 'Feminino' }, { value: 'male', label: 'Masculino' }];
export const genderLabel = (g: Gender) => GENDERS.find((x) => x.value === g)?.label ?? (g === 'other' ? 'Outro' : g === 'unspecified' ? 'Prefiro não dizer' : '');
