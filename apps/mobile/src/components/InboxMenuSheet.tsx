import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NameWithBadge, type Badged } from '@/components/NameWithBadge';
import { Sheet } from '@/components/Sheet';
import { ActionRow } from '@/components/ui/ActionRow';
import type { InboxMenuItem } from '@/lib/inboxMenu';
import { colors } from '@/lib/theme';

/**
 * A folha de segurar uma linha da lista de Mensagens (conversa a dois ou TxillGroup), como no WhatsApp e no Instagram:
 * a foto e o nome (com o selo, `who`) em cima e as ações por baixo (lib/inboxMenu, inboxMenuItems, com o ActionRow comum),
 * com «Cancelar» no fim (o da folha). Escolher uma ação fecha a folha e corre-a (`onPick`); «Cancelar» só fecha.
 */
export function InboxMenuSheet({ name, who, sub, photo, items, onPick, onClose }: {
  name: string;
  /** Conversa a dois: o selo de verificado da outra pessoa. */
  who?: Badged | null;
  sub?: string;
  photo: ReactNode;
  items: InboxMenuItem[];
  onPick: (id: InboxMenuItem['id']) => void;
  onClose: () => void;
}) {
  const cancel = items.find((it) => it.id === 'cancel');
  return (
    <Sheet onClose={onClose} cancel={cancel ? cancel.label : false}>
      <View style={st.wrap}>
        <View style={st.head}>
          {photo}
          <View style={{ flex: 1, minWidth: 0 }}>
            <NameWithBadge name={name} who={who} style={st.name} />
            {sub ? <Text style={st.sub} numberOfLines={1}>{sub}</Text> : null}
          </View>
        </View>
        {items.filter((it) => it.id !== 'cancel').map((it) => (
          <ActionRow key={it.id} icon={it.icon} title={it.label} danger={it.danger} onPress={() => onPick(it.id)} />
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
});
