import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { deskZone } from '@/lib/deskChat';
import { menuPosition } from '@/lib/deskChatKeys';
import { colors } from '@/lib/theme';

export interface DeskMenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Vermelho: apaga ou sai (as confirmações de sempre vêm a seguir). */
  danger?: boolean;
  onPress: () => void;
}

type HoverState = { pressed: boolean; hovered?: boolean; focused?: boolean };

/**
 * Menu de contexto das Mensagens no computador (botão direito, ou o "⋯" que aparece ao passar o rato), como o do
 * WhatsApp e do Messenger no computador: abre junto ao ponteiro (ou por baixo do botão) e encosta-se para dentro da janela.
 * - clicar fora, o botão direito fora ou Esc fecham-no (o Esc é o do Modal do react-native-web);
 * - ↑/↓ andam entre as opções, Enter escolhe; abre com o foco na primeira;
 * - escolher corre a ação e fecha o menu (as confirmações, folhas e alertas, abrem por cima da conversa).
 * `header`: o que vai por cima das opções (as reações, no menu de uma mensagem).
 */
export function DeskMenu({ at, items, onClose, header, label }: { at: { x: number; y: number }; items: DeskMenuItem[]; onClose: () => void; header?: ReactNode; label: string }) {
  const win = useWindowDimensions();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const box = useRef<HTMLElement | null>(null);
  const pos = size ? menuPosition(at, size, { w: win.width, h: win.height }) : { left: at.x, top: at.y };
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && s.w === Math.round(width) && s.h === Math.round(height) ? s : { w: Math.round(width), h: Math.round(height) }));
  };
  // Foco na primeira opção; ↑/↓/Home/End andam entre elas.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    const opts = () => Array.from(el.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const t = setTimeout(() => opts()[0]?.focus(), 0);
    const key = (e: KeyboardEvent) => {
      const list = opts();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      let j = -1;
      if (e.key === 'ArrowDown') j = i < 0 ? 0 : (i + 1) % list.length;
      else if (e.key === 'ArrowUp') j = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = list.length - 1;
      else if (e.key === 'Tab') { e.preventDefault(); onClose(); return; }
      if (j < 0) return;
      e.preventDefault();
      list[j].focus();
    };
    el.addEventListener('keydown', key);
    return () => { clearTimeout(t); el.removeEventListener('keydown', key); };
  }, [onClose]);
  const pick = (it: DeskMenuItem) => {
    it.onPress();
    onClose();
  };
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        {...({ onContextMenu: (e: { preventDefault(): void }) => { e.preventDefault(); onClose(); } } as object)}
        accessibilityLabel="Fechar o menu"
        focusable={false}
      />
      <View
        ref={box as never}
        onLayout={onLayout}
        {...deskZone(true)}
        role="menu"
        aria-label={label}
        style={[st.menu, { left: pos.left, top: pos.top, opacity: size ? 1 : 0 }]}
        {...({ onContextMenu: (e: { preventDefault(): void }) => e.preventDefault() } as object)}
      >
        {header}
        {items.map((it) => (
          <Pressable
            key={it.id}
            onPress={() => pick(it)}
            accessibilityRole={'menuitem' as never}
            accessibilityLabel={it.label}
            style={(s) => [st.item, ((s as HoverState).hovered || (s as HoverState).focused) && { backgroundColor: it.danger ? '#fef2f2' : colors.zinc100 }, s.pressed && { backgroundColor: it.danger ? '#fee2e2' : colors.zinc200 }]}
          >
            {it.icon ? <Icon name={it.icon} size={18} color={it.danger ? '#b91c1c' : colors.zinc700} /> : null}
            <Text style={[st.label, it.danger && { color: '#b91c1c' }]} numberOfLines={1}>{it.label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  menu: { position: 'absolute', minWidth: 220, maxWidth: 320, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.zinc200, boxShadow: '0 10px 32px rgba(24,24,27,0.18), 0 2px 6px rgba(24,24,27,0.08)' } as object,
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 38, paddingHorizontal: 14, marginHorizontal: 6, borderRadius: 8, outlineStyle: 'none' } as object,
  label: { flexShrink: 1, fontSize: 14, fontWeight: '500', color: colors.zinc900 },
});
