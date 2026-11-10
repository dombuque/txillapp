import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';

/**
 * O menu "+" da barra de escrever: o que não cabe na pílula (localização, presente e "ver uma vez").
 * Cada opção é uma linha com ícone redondo, título e uma frase curta, como no menu de uma mensagem.
 */
export function ChatAttachSheet({
  firstName, canGift, once, onClose, onPlace, onGift, onToggleOnce,
}: {
  firstName?: string;
  canGift?: boolean;
  once: boolean;
  onClose: () => void;
  onPlace: () => void;
  onGift: () => void;
  onToggleOnce: () => void;
}) {
  const row = (icon: IconName, title: string, sub: string, run: () => void, on?: boolean) => (
    <Pressable
      key={title}
      onPress={() => { onClose(); run(); }}
      style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.zinc100 }]}
      accessibilityRole={on === undefined ? 'button' : 'switch'}
      accessibilityState={on === undefined ? undefined : { checked: on }}
      accessibilityLabel={`${title}. ${sub}`}
    >
      <View style={[st.icon, on && { backgroundColor: colors.brand }]}>
        <Icon name={icon} size={22} color={on ? '#fff' : colors.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.title}>{title}</Text>
        <Text style={st.sub}>{sub}</Text>
      </View>
      {on !== undefined && (
        <View style={[st.track, on && { backgroundColor: colors.brand }]} pointerEvents="none">
          <View style={[st.knob, on && { alignSelf: 'flex-end' }]} />
        </View>
      )}
    </Pressable>
  );
  return (
    <Sheet title="Partilhar" onClose={onClose}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
        {row('map-pin', 'Localização', 'Envia onde estás agora.', onPlace)}
        {canGift ? row('gift', 'Presente', `Oferece Txills${firstName ? ` a ${firstName}` : ''}.`, onGift) : null}
        {row('once', 'Ver uma vez', once ? 'Ligado: a próxima foto, vídeo ou voz só se abre uma vez.' : 'A próxima foto, vídeo ou voz só se abre uma vez.', onToggleOnce, once)}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, paddingHorizontal: 8, paddingVertical: 10, minHeight: 64 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(214,51,79,0.1)', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  sub: { marginTop: 1, fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  track: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.zinc300, padding: 3, justifyContent: 'center' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
});
