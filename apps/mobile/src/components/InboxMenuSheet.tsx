import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import type { InboxMenuItem } from '@/lib/inboxMenu';
import { colors } from '@/lib/theme';

/**
 * A folha de segurar uma linha da lista de Mensagens (conversa a dois ou TxillGroup), como no WhatsApp e no Instagram:
 * a foto e o nome em cima e as ações por baixo (lib/inboxMenu, inboxMenuItems), com "Cancelar" no fim.
 * Escolher uma ação fecha a folha e corre-a (`onPick`); "Cancelar" só fecha.
 */
export function InboxMenuSheet({ name, sub, photo, items, onPick, onClose }: {
  name: string;
  sub?: string;
  photo: ReactNode;
  items: InboxMenuItem[];
  onPick: (id: InboxMenuItem['id']) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose}>
      <View style={st.wrap}>
        <View style={st.head}>
          {photo}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.name} numberOfLines={1} accessibilityRole="header">{name}</Text>
            {sub ? <Text style={st.sub} numberOfLines={1}>{sub}</Text> : null}
          </View>
        </View>
        {items.map((it) => it.id === 'cancel' ? (
          <Pressable key={it.id} onPress={onClose} style={({ pressed }) => [st.cancel, pressed && { backgroundColor: colors.zinc200 }]} accessibilityRole="button" accessibilityLabel={it.label}>
            <Text style={st.cancelText}>{it.label}</Text>
          </Pressable>
        ) : (
          <Pressable key={it.id} onPress={() => onPick(it.id)} style={({ pressed }) => [st.row, pressed && { backgroundColor: it.danger ? '#fef2f2' : colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={it.label}>
            <View style={[st.icon, it.danger && { backgroundColor: '#fef2f2' }]}><Icon name={it.icon} size={22} color={it.danger ? '#b91c1c' : colors.zinc800} /></View>
            <Text style={[st.label, it.danger && { color: '#b91c1c' }]} numberOfLines={1}>{it.label}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingBottom: 12, marginBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.zinc200 },
  name: { fontSize: 18, fontWeight: '700', color: colors.zinc900 },
  sub: { fontSize: 14, color: colors.zinc500 },
  // Áreas de toque com pelo menos 44 pt (aqui 56).
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, paddingHorizontal: 4, paddingVertical: 6 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 17, fontWeight: '600', color: colors.zinc900 },
  cancel: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 8, backgroundColor: colors.zinc100 },
  cancelText: { fontSize: 17, fontWeight: '600', color: colors.zinc800 },
});
