import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { api } from '@/lib/api';
import { TERMS_CHANGES } from '@/lib/legalText';
import { colors } from '@/lib/theme';

/**
 * Quando os Termos ou a Política de Privacidade mudam (TERMS_VERSION), quem já tinha conta vê este aviso com o resumo
 * do que mudou e aceita. Se fechar sem aceitar, volta a aparecer na próxima vez que abrir a app.
 */
export function TermsUpdate() {
  const router = useRouter();
  const qc = useQueryClient();
  const [later, setLater] = useState(false);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const q = useQuery({ queryKey: ['privacy'], queryFn: api.privacy, staleTime: 5 * 60_000 });
  const accept = useMutation({
    mutationFn: api.acceptTerms,
    onSuccess: (d) => qc.setQueryData(['privacy'], d),
  });
  if (later || !q.data || q.data.termsAccepted !== false || accept.isSuccess) return null;
  const open = (to: '/terms' | '/privacy') => { setLater(true); router.push(to as never); };
  return (
    <Sheet title="Atualizámos os termos" onClose={() => setLater(true)}>
      {/* A lista do que mudou faz scroll; o botão fica sempre à vista por baixo (num ecrã pequeno ficava escondido). */}
      <ScrollView style={{ maxHeight: Math.max(200, height * 0.55) }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 14 }} showsVerticalScrollIndicator>
        <Text style={st.lead}>O Txillapp cresceu. Isto é o que mudou nos Termos e na Política de Privacidade:</Text>
        {/* As mais recentes primeiro: quem já aceitou as anteriores vê logo, no topo, o que é novo. */}
        {[...TERMS_CHANGES].reverse().map((c) => (
          <View key={c} style={st.item}>
            <View style={st.check}><Icon name="check" size={14} color={colors.brand} strokeWidth={2.6} /></View>
            <Text style={st.itemText}>{c}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          <Pressable onPress={() => open('/terms')} accessibilityRole="link"><Text style={st.link}>Ler os Termos</Text></Pressable>
          <Pressable onPress={() => open('/privacy')} accessibilityRole="link"><Text style={st.link}>Ler a Privacidade</Text></Pressable>
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12), gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.zinc200 }}>
        {accept.isError ? <Text style={st.err}>Não consegui guardar. Tenta outra vez.</Text> : null}
        <Pressable onPress={() => accept.mutate()} disabled={accept.isPending} style={({ pressed }) => [st.btn, (pressed || accept.isPending) && { opacity: 0.8 }]} accessibilityRole="button">
          <Text style={st.btnText}>{accept.isPending ? 'A guardar…' : 'Aceitar e continuar'}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  lead: { fontSize: 15, color: colors.zinc700, lineHeight: 21 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  check: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  itemText: { flex: 1, fontSize: 15, color: colors.zinc900, lineHeight: 21 },
  link: { fontSize: 15, fontWeight: '600', color: colors.brand },
  err: { fontSize: 14, color: colors.red600 },
  btn: { height: 50, borderRadius: 25, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
