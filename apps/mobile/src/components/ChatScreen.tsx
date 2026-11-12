import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '@/components/Icon';
import { useVisibleViewport } from '@/components/zas/useVisibleViewport';
import { composerInset, webKeyboardOpen } from '@/lib/chatKeyboard';
import { ChatDropCtx, deskZone, useDeskChat, useDeskChatChrome, type DropHandler } from '@/lib/deskChat';
import { dragDepth, dragHasFiles } from '@/lib/deskChatKeys';
import { colors } from '@/lib/theme';

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

  // Computador: arrastar ficheiros para a conversa mostra a zona de largar; largar entrega-os à caixa de escrever
  // (o mesmo que colar: imagem → pré-visualização com Enviar/Cancelar; outro ficheiro → o aviso). Sem caixa (pedido de
  // mensagem, conversa bloqueada) o browser não abre o ficheiro por cima da app e nada acontece.
  const desk = useDeskChat();
  useDeskChatChrome(desk);
  const box = useRef<HTMLElement | null>(null);
  const handler = useRef<DropHandler | null>(null);
  const drop = useMemo(() => ({ set: (fn: DropHandler | null) => { handler.current = fn; } }), []);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!desk || !el || typeof el.addEventListener !== 'function') return;
    let depth = 0;
    const set = (d: number) => { depth = d; setDragging(d > 0); };
    const enter = (e: DragEvent) => { if (dragHasFiles(e.dataTransfer?.types)) set(dragDepth(depth, 'enter')); };
    const leave = (e: DragEvent) => { if (dragHasFiles(e.dataTransfer?.types)) set(dragDepth(depth, 'leave')); };
    const over = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = handler.current ? 'copy' : 'none';
    };
    // Em captura: esconde a zona mesmo quando quem fica com o ficheiro é a própria caixa de escrever.
    const reset = () => set(dragDepth(depth, 'drop'));
    const dropped = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      e.preventDefault();
      handler.current?.(e, e.dataTransfer);
    };
    el.addEventListener('dragenter', enter);
    el.addEventListener('dragleave', leave);
    el.addEventListener('dragover', over);
    el.addEventListener('drop', reset, true);
    el.addEventListener('drop', dropped);
    window.addEventListener('dragend', reset);
    return () => {
      el.removeEventListener('dragenter', enter);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('dragover', over);
      el.removeEventListener('drop', reset, true);
      el.removeEventListener('drop', dropped);
      window.removeEventListener('dragend', reset);
    };
  }, [desk]);

  return (
    <ChatDropCtx.Provider value={drop}>
      <View ref={box as never} {...deskZone(desk)} style={[style, pinned && vv ? { position: 'absolute', left: 0, right: 0, top: vv.top, height: vv.height } : null]}>
        {children}
        {dragging ? (
          <View pointerEvents="none" style={st.drop} accessibilityLiveRegion="polite" accessibilityLabel="Larga a imagem para a enviar">
            <View style={st.dropIn}>
              <Icon name="image" size={34} color={colors.brand} />
              <Text style={st.dropTitle}>Larga aqui para enviar</Text>
              <Text style={st.dropSub}>Fotos JPEG, PNG ou WebP, até 8 MB. Vês antes de enviar.</Text>
            </View>
          </View>
        ) : null}
      </View>
    </ChatDropCtx.Provider>
  );
}

const st = StyleSheet.create({
  drop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 50, padding: 16, backgroundColor: 'rgba(255,255,255,0.94)' },
  dropIn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 24, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.brand, backgroundColor: '#fff5f6' },
  dropTitle: { fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  dropSub: { fontSize: 14, color: colors.zinc600 },
});
