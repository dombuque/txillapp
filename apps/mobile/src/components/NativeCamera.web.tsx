/**
 * No browser a câmara é a TxCamera (câmara ao vivo do browser). Esta versão vazia evita que a câmara nativa
 * (expo-camera + Skia, só para Android/iPhone) entre no código do site.
 */
export function NativeCamera(_props: Record<string, unknown>) {
  return null;
}
