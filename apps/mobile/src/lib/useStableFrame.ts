import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';
import { useVisibleViewport } from '@/components/zas/useVisibleViewport';
import { stableScreen, visibleArea, type Size } from './prepKeyboard';

/** A altura do teclado no telemóvel (avisos do sistema). Na web é 0: lá conta a zona visível (visualViewport). */
function useNativeKeyboard(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  return h;
}

/** Quanto o painel de baixo sobe para ficar por cima do teclado, num ecrã com `screenH` de altura (sem o teclado). */
export function liftFor(screenH: number, visibleBottom: number): number {
  return Math.max(0, Math.round(screenH - visibleBottom));
}

/**
 * Ecrãs inteiros com moldura 9:16 (ou câmara) e um campo para escrever (lib/prepKeyboard, como na Txillada):
 * - `screen`: o tamanho do ecrã sem o teclado. Fica parado enquanto se escreve, por isso a moldura não encolhe quando o
 *   teclado abre (no iPhone a janela da web encolhe para a zona visível; no Android a janela pode encolher sozinha).
 *   O ecrã usa `height: screen.h` em vez de `flex: 1`.
 * - `lift`: quanto o painel de baixo (legenda, cores, letras) sobe para ficar por cima do teclado. 0 sem teclado.
 * `typing`: há um campo deste ecrã a ser escrito (o teclado está ou vai estar aberto).
 */
export function useStableFrame(typing: boolean): { screen: Size; lift: number } {
  const win = useWindowDimensions();
  const vv = useVisibleViewport();
  const kb = useNativeKeyboard();
  const web = Platform.OS === 'web';
  const still = useRef<Size>({ w: 0, h: 0 });
  still.current = stableScreen(still.current, { w: win.width, h: win.height }, typing || kb > 0);
  const screen = still.current;
  if (!typing && !kb) return { screen, lift: 0 };
  const vis = visibleArea({ web, vv: web && vv ? { top: vv.top, height: vv.height } : null, rootH: web ? screen.h : win.height, screenH: screen.h, kb: web ? 0 : kb });
  return { screen, lift: liftFor(screen.h, vis.bottom) };
}
