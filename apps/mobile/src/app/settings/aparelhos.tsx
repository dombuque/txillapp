import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { IconDot, SettingsSection, settingsStyles as s } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
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

/** Uma linha da lista, com o mesmo desenho das linhas das Definições (components/settings/SettingRow). */
function DeviceRow({ d, busy, onEnd }: { d: Aparelho; busy?: boolean; onEnd?: () => void }) {
  return (
    <View style={st.row} accessible={!onEnd} accessibilityLabel={onEnd ? undefined : `${d.device}, ${detalheAparelho(d)}`}>
      <IconDot><Icon name={eTelemovel(d) ? 'phone' : 'laptop'} size={20} color={colors.zinc800} /></IconDot>
      <View style={st.texts}>
        <Text style={st.title} numberOfLines={2}>{d.device}</Text>
        <Text style={st.desc}>{detalheAparelho(d)}</Text>
      </View>
      {onEnd ? (
        <Pressable onPress={onEnd} disabled={busy} style={[s.outline, busy && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Terminar sessão em ${d.device}`}>
          <Text style={st.outlineText}>Terminar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Definições › Segurança › Os teus aparelhos: onde a conta tem sessão iniciada, e terminar a sessão em cada um.
 * É um ecrã do grupo Segurança: no computador abre na coluna da direita (settings/_layout), com a lista dos grupos à vista.
 */
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
  const list = ordenarAparelhos(q.data ?? []);
  const here = list.filter((d) => d.current);
  const rest = list.filter((d) => !d.current);

  return (
    <SettingsPage title="Os teus aparelhos">
      <Text style={st.lead}>Onde a tua conta tem sessão iniciada, com a data em que entraste e a última atividade. Não reconheces algum? Termina a sessão nele e muda a senha.</Text>
      {q.isLoading && <ActivityIndicator style={{ margin: 24 }} color={colors.brand} />}
      {q.isError && (
        <View style={st.errorBox}>
          <Text style={st.errorText}>Não foi possível carregar os aparelhos.</Text>
          <Pressable onPress={() => void q.refetch()} style={s.outline} accessibilityRole="button"><Text style={st.outlineText}>Tentar outra vez</Text></Pressable>
        </View>
      )}
      {q.isSuccess && list.length === 0 && <Text style={s.none}>Sem sessões iniciadas.</Text>}
      <SettingsSection title="Este aparelho">
        {here.map((d) => <DeviceRow key={d.id} d={d} />)}
      </SettingsSection>
      <SettingsSection title="Outros aparelhos">
        {rest.map((d) => (
          <DeviceRow
            key={d.id}
            d={d}
            busy={one.isPending && one.variables === d.id}
            onEnd={() => confirmar('Terminar sessão?', `${d.device} deixa de ter acesso à tua conta dentro de poucos minutos.`, 'Terminar', () => one.mutate(d.id))}
          />
        ))}
      </SettingsSection>
      {err ? <Text style={st.err} accessibilityLiveRegion="polite">{err}</Text> : null}
      {rest.length > 1 && (
        <View style={{ paddingHorizontal: 16 }}>
          <Pressable
            onPress={() => confirmar('Terminar todas as outras?', 'Ficas só com a sessão deste aparelho.', 'Terminar todas', () => others.mutate())}
            disabled={others.isPending}
            style={[s.ghost, { marginTop: 16 }, others.isPending && { opacity: 0.5 }]}
            accessibilityRole="button"
          >
            {others.isPending ? <ActivityIndicator color={colors.zinc800} /> : <Text style={s.ghostText}>Terminar sessão em todos os outros</Text>}
          </Pressable>
        </View>
      )}
      {q.isSuccess ? <Text style={st.note}>Nas sessões não guardamos o endereço IP: só o tipo de aparelho e de browser, a versão da app e as datas.</Text> : null}
    </SettingsPage>
  );
}

const st = StyleSheet.create({
  lead: { marginTop: 16, paddingHorizontal: 20, fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  // As medidas da linha das Definições (SettingRow), com o botão Terminar à direita.
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.white },
  texts: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '500', color: colors.zinc900 },
  desc: { marginTop: 2, fontSize: 14, lineHeight: 19, color: colors.zinc600 },
  outlineText: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
  errorBox: { marginTop: 16, marginHorizontal: 16, gap: 10, alignItems: 'flex-start', borderRadius: 14, backgroundColor: '#fef2f2', padding: 14 },
  errorText: { fontSize: 14, color: '#7f1d1d' },
  err: { marginTop: 10, paddingHorizontal: 24, fontSize: 14, color: colors.red600 },
  note: { marginTop: 20, paddingHorizontal: 24, fontSize: 13, lineHeight: 18, color: colors.zinc500 },
});
