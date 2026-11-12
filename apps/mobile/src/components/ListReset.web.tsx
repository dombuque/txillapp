import type { ReactNode } from 'react';
// @ts-expect-error: o react-native-web não publica os tipos desta parte (é a mesma que o Modal dele devia usar).
import { VirtualizedListContextResetter } from 'react-native-web/dist/vendor/react-native/VirtualizedList/VirtualizedListContext';

/**
 * Web: uma folha abre por cima (num portal), mas o React passa-lhe o contexto da lista de onde veio (o feed). Uma FlatList
 * vertical lá dentro (os comentários) julgava-se «aninhada» na lista do feed e o react-native-web desenhava-a como uma View
 * simples: sem scroll, nem com a roda nem com o dedo. Isto recomeça o contexto, como o Modal do React Native faz.
 */
export function ListReset({ children }: { children: ReactNode }) {
  return <VirtualizedListContextResetter>{children}</VirtualizedListContextResetter>;
}
