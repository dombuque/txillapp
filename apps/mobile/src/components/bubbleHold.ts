import { createContext, useContext } from 'react';

/**
 * Carregar e segurar uma bolha abre o menu da mensagem, esteja o dedo onde estiver dentro dela.
 *
 * No React Native (e no react-native-web) quem fica com o toque é o Pressable mais fundo: se a bolha tiver lá dentro um
 * Pressable próprio (o mapa da localização, a foto, a publicação partilhada, a chamada, a citação, o "ver uma vez", a
 * sondagem, os botões da voz...) sem `onLongPress`, segurar ali não chegava ao Pressable da bolha e o menu não abria.
 * Por isso a bolha dá este contexto e TODOS os Pressable de dentro espalham `{...useBubbleHold()}`
 * (tests/bubbleHold.test.mjs verifica-o, tipo a tipo).
 */
export type BubbleHold = { onLongPress?: () => void; delayLongPress?: number };

export const BubbleHoldCtx = createContext<BubbleHold>({});

export const useBubbleHold = (): BubbleHold => useContext(BubbleHoldCtx);
