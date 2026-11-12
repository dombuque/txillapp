import type { StoreAdapter } from './core';

/** Na web (o site e o PWA) não há loja: nada se compra por aqui e nada se carrega da biblioteca das lojas. */
const none = () => Promise.reject(Object.assign(new Error('Sem loja na web'), { code: 'iap-not-available' }));

export const nativeStore: StoreAdapter = {
  available: false,
  connect: none,
  products: () => Promise.resolve([]),
  buy: none,
  listen: () => () => undefined,
  listenErrors: () => () => undefined,
  unfinished: () => Promise.resolve([]),
  owned: () => Promise.resolve([]),
  finish: () => Promise.resolve(),
  manage: () => Promise.resolve(),
};
