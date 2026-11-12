import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { useVisibleViewport } from '@/components/zas/useVisibleViewport';
import { composerInset, webKeyboardOpen } from '@/lib/chatKeyboard';

/**
 * O teclado está aberto? No telemóvel pelos avisos do sistema; na web pela zona visível (lib/chatKeyboard).
 * Só muda (e só faz render) quando abre ou fecha, não a cada passo da animação.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') {
      const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
      const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
      return () => { a.remove(); b.remove(); };
    }
    const v = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!v) return;
    const on = () => setOpen(webKeyboardOpen(v.height, window.innerHeight));
    on();
    v.addEventListener('resize', on);
    return () => v.removeEventListener('resize', on);
  }, []);
  return open;
}

/** A margem de baixo para a barra de escrever (e a de editar) da conversa: nenhuma com o teclado aberto. */
export function useComposerBottom(bottom: number): number {
  return composerInset(bottom, useKeyboardOpen());
}

/**
 * O ecrã de uma conversa (1:1 e TxillGroups). No telemóvel é o KeyboardAvoidingView de sempre. Na web, com o teclado
 * aberto no iPhone, ocupa só a zona visível e a página não rola por baixo (o cabeçalho e a última mensagem ficam à vista),
 * como o visor dos mimos (app/stories).
 */
export function ChatScreen({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  if (Platform.OS !== 'web') return <KeyboardAvoidingView style={style} behavior="padding">{children}</KeyboardAvoidingView>;
  return <WebChatScreen style={style}>{children}</WebChatScreen>;
}

function WebChatScreen({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  const vv = useVisibleViewport();
  const pinned = !!vv && typeof window !== 'undefined' && webKeyboardOpen(vv.height, window.innerHeight);
  useEffect(() => {
    if (!pinned || typeof window === 'undefined') return;
    const fix = () => window.scrollTo(0, 0);
    fix();
    window.addEventListener('scroll', fix);
    return () => window.removeEventListener('scroll', fix);
  }, [pinned, vv?.top, vv?.height]);
  return <View style={[style, pinned && vv ? { position: 'absolute', left: 0, right: 0, top: vv.top, height: vv.height } : null]}>{children}</View>;
}
