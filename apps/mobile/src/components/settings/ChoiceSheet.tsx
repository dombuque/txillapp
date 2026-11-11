import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { colors } from '@/lib/theme';

/** Folha de escolha única que aplica logo ao tocar. */
export function ChoiceSheet<T extends string>({ title, intro, options, value, onPick, onClose }: { title: string; intro?: string; options: readonly { value: T; title: string; text: string }[]; value: T; onPick: (v: T) => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 8 }}>
        {intro ? <Text style={{ marginBottom: 4, fontSize: 14, color: colors.zinc600 }}>{intro}</Text> : null}
        <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ gap: 8 }}>
          {options.map((o) => {
            const on = value === o.value;
            return (
              <Pressable key={o.value} onPress={() => { onPick(o.value); onClose(); }} style={[st.choice, on && { borderColor: colors.brand, backgroundColor: colors.rose50 }]} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${o.title}. ${o.text}`}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.zinc900 }}>{o.title}</Text>
                  <Text style={{ fontSize: 14, color: colors.zinc600 }}>{o.text}</Text>
                </View>
                <View style={[st.radio, on && { borderColor: colors.brand, backgroundColor: colors.brand }]}>{on && <Icon name="check" size={14} color="#fff" strokeWidth={3} />}</View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  choice: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, paddingHorizontal: 16, paddingVertical: 14 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
});
