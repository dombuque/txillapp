import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { FollowButton } from '@/components/FollowButton';
import { Icon } from '@/components/Icon';
import { aiApi } from '@/lib/api.ai';
import { colors } from '@/lib/theme';

/** O raio do SuperTxill, cheio (como o "bolt" do site com fill). */
export function Bolt({ size = 20, color = colors.brand }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6z" />
    </Svg>
  );
}

function BotAvatar({ size }: { size: number }) {
  return (
    <LinearGradient colors={[colors.brand, '#ff9a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Bolt size={Math.round(size * 0.5)} color="#fff" />
    </LinearGradient>
  );
}

/** O SuperTxill, aberto a partir da barra de pesquisa: ecrã inteiro, só com dados do Txillapp. */
export function SuperTxillPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const q = useQuery({ queryKey: ['supertxill-for-you'], queryFn: aiApi.forYou, staleTime: 60_000 });
  const list = q.data ?? [];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: colors.white, alignItems: 'center' }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 576 }}>
          <View style={[s.header, { paddingTop: Math.max(12, insets.top) }]}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Voltar" style={s.back}><Icon name="chevron-left" size={26} /></Pressable>
            <BotAvatar size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.title}>SuperTxill</Text>
              <Text style={s.sub} numberOfLines={1}>Escolhido para ti, com o que se passa no Txillapp</Text>
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(24, insets.bottom + 16) }} keyboardShouldPersistTaps="handled">
            <Text style={s.h2}>Malta para ti</Text>
            {q.isLoading && <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />}
            {q.isError && <Text accessibilityRole="alert" style={s.note}>Não consegui ver agora. Tenta daqui a pouco.</Text>}
            {q.isSuccess && list.length === 0 && <Text style={[s.note, { color: colors.zinc600, fontSize: 15 }]}>Ainda não tenho malta para te mostrar. Segue algumas pessoas e põe gostos na tua geleira, e eu aprendo contigo.</Text>}
            <View style={{ marginTop: 8 }}>
              {list.map((p) => (
                <View key={p.username} style={s.row}>
                  <Pressable onPress={() => { onClose(); router.push(`/u/${p.username}` as never); }} style={s.who} accessibilityRole="button">
                    <Avatar name={p.displayName} username={p.username} size={48} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={s.name} numberOfLines={1}>{p.displayName}</Text>
                        {p.isPrivate && <Icon name="lock" size={14} color={colors.zinc500} />}
                      </View>
                      <Text style={s.reason} numberOfLines={1}>{p.reason}</Text>
                    </View>
                  </Pressable>
                  <View style={{ width: 104 }}>
                    <FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} />
                  </View>
                </View>
              ))}
            </View>
            <Text style={s.box}>Isto é calculado pelo Txillapp, só com dados do Txillapp: quem segues e os gostos da tua geleira. Nada sai para fora. Só aparecem pessoas que aceitam ser sugeridas. Podes desligar o uso da geleira nas Definições.</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.zinc100 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', lineHeight: 22, color: colors.zinc900 },
  sub: { fontSize: 12, color: colors.zinc500 },
  h2: { fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  note: { marginTop: 24, textAlign: 'center', color: colors.zinc500, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 16, fontWeight: '600', color: colors.zinc900, flexShrink: 1 },
  reason: { fontSize: 14, color: colors.zinc500 },
  box: { marginTop: 24, borderRadius: 16, backgroundColor: '#fafafa', padding: 14, fontSize: 13, lineHeight: 18, color: colors.zinc600 },
});
