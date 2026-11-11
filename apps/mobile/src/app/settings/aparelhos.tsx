import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { detalheAparelho, eTelemovel, ordenarAparelhos, type Aparelho } from '@/lib/aparelhos';
import { colors } from '@/lib/theme';

/** Pergunta antes de terminar (no browser, o Alert do React Native não tem botões: usa-se o confirm). */
function confirmar(title: string, text: string, ok: string, go: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${text}`)) go();
    return;
  }
  Alert.alert(title, text, [{ text: 'Cancelar', style: 'cancel' }, { text: ok, style: 'destructive', onPress: go }]);
}

/** Definições › Segurança › Os teus aparelhos: onde a conta tem sessão iniciada, e terminar a sessão em cada um. */
export default function Aparelhos() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['devices'], queryFn: api.sessions });
  const [err, setErr] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['devices'] });
  const one = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onMutate: () => setErr(''),
    onError: (e) => setErr((e as Error).message || 'Não foi possível terminar a sessão.'),
    onSettled: () => void refresh(),
  });
  const others = useMutation({
    mutationFn: () => api.revokeOtherSessions(),
    onMutate: () => setErr(''),
    onError: (e) => setErr((e as Error).message || 'Não foi possível terminar as sessões.'),
    onSettled: () => void refresh(),
  });
  const list = ordenarAparelhos((q.data ?? []) as Aparelho[]);
  const nOthers = list.filter((d) => !d.current).length;

  return (
    <StackPage title="Os teus aparelhos">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 }}>
        <Text style={st.lead}>Onde a tua conta tem sessão iniciada, com a data em que entraste e a última atividade. Não reconheces algum? Termina a sessão nele e muda a senha.</Text>
        {q.isLoading && <ActivityIndicator style={{ margin: 24 }} color={colors.brand} />}
        {q.isError && (
          <View style={st.errorBox}>
            <Text style={st.errorText}>Não foi possível carregar os aparelhos.</Text>
            <Pressable onPress={() => void q.refetch()} style={st.outline} accessibilityRole="button"><Text style={st.outlineText}>Tentar outra vez</Text></Pressable>
          </View>
        )}
        {q.isSuccess && list.length === 0 && <Text style={st.empty}>Sem sessões iniciadas.</Text>}
        {list.map((d) => (
          <View key={d.id} style={st.row}>
            <View style={st.icon}><Icon name={eTelemovel(d) ? 'phone' : 'laptop'} size={22} color={colors.zinc800} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.name} numberOfLines={2}>{d.device}</Text>
              {d.current && <Text style={st.here}>Este aparelho</Text>}
              <Text style={st.sub}>{detalheAparelho(d)}</Text>
            </View>
            {!d.current && (
              <Pressable
                onPress={() => confirmar('Terminar sessão?', `${d.device} deixa de ter acesso à tua conta dentro de poucos minutos.`, 'Terminar', () => one.mutate(d.id))}
                disabled={one.isPending}
                style={[st.outline, one.isPending && one.variables === d.id && { opacity: 0.5 }]}
                accessibilityRole="button"
                accessibilityLabel={`Terminar sessão em ${d.device}`}
              >
                <Text style={st.outlineText}>Terminar sessão</Text>
              </Pressable>
            )}
          </View>
        ))}
        {err ? <Text style={st.err}>{err}</Text> : null}
        {nOthers > 1 && (
          <Pressable
            onPress={() => confirmar('Terminar todas as outras?', 'Ficas só com a sessão deste aparelho.', 'Terminar todas', () => others.mutate())}
            disabled={others.isPending}
            style={[st.ghost, others.isPending && { opacity: 0.5 }]}
            accessibilityRole="button"
          >
            {others.isPending ? <ActivityIndicator color={colors.zinc800} /> : <Text style={st.ghostText}>Terminar sessão em todos os outros</Text>}
          </Pressable>
        )}
        <Text style={st.note}>Nas sessões não guardamos o endereço IP: só o tipo de aparelho e de browser, a versão da app e as datas.</Text>
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  lead: { marginBottom: 12, fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.zinc200 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  here: { alignSelf: 'flex-start', marginTop: 3, borderRadius: 6, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 1, fontSize: 12, fontWeight: '700', color: '#166534', backgroundColor: '#dcfce7' },
  sub: { marginTop: 2, fontSize: 13, color: colors.zinc600 },
  outline: { borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, paddingHorizontal: 14, paddingVertical: 8 },
  outlineText: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  ghost: { marginTop: 16, height: 50, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 16, fontWeight: '600', color: colors.zinc800 },
  empty: { marginVertical: 24, textAlign: 'center', fontSize: 14, color: colors.zinc500 },
  errorBox: { marginVertical: 12, gap: 10, alignItems: 'flex-start', borderRadius: 14, backgroundColor: '#fef2f2', padding: 14 },
  errorText: { fontSize: 14, color: '#7f1d1d' },
  err: { marginTop: 10, fontSize: 14, color: colors.red600 },
  note: { marginTop: 20, fontSize: 12, lineHeight: 17, color: colors.zinc500 },
});
