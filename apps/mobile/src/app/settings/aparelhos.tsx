import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PageLoader } from '@/components/PontoLoader';
import { IconDot, SettingsSection, settingsStyles as s } from '@/components/settings/SettingRow';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { api } from '@/lib/api';
import { detalheAparelho, eTelemovel, ordenarAparelhos, type Aparelho } from '@/lib/aparelhos';
import { confirm } from '@/lib/confirm';
import { colors } from '@/lib/theme';

/** Pergunta antes de terminar, na caixa da app (igual no telemóvel e no site). */
async function confirmar(title: string, text: string, ok: string, go: () => void) {
  if (await confirm({ title, message: text, confirm: ok, danger: true })) go();
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
        <Button label="Terminar" kind="secondary" size="sm" loading={busy} onPress={onEnd} accessibilityLabel={`Terminar sessão em ${d.device}`} />
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
      {q.isLoading && <PageLoader style={{ paddingTop: 24 }} />}
      {q.isError && <ErrorState what="os teus aparelhos" onRetry={() => void q.refetch()} />}
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
            onEnd={() => void confirmar('Terminar sessão?', `${d.device} deixa de ter acesso à tua conta dentro de poucos minutos.`, 'Terminar', () => one.mutate(d.id))}
          />
        ))}
      </SettingsSection>
      {err ? <Text style={st.err} accessibilityLiveRegion="polite">{err}</Text> : null}
      {rest.length > 1 && (
        <View style={{ paddingHorizontal: 16 }}>
          <Button
            label="Terminar sessão em todos os outros"
            kind="secondary"
            loading={others.isPending}
            onPress={() => void confirmar('Terminar todas as outras?', 'Ficas só com a sessão deste aparelho.', 'Terminar todas', () => others.mutate())}
            style={{ marginTop: 16 }}
          />
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
  err: { marginTop: 10, paddingHorizontal: 24, fontSize: 14, color: colors.danger },
  note: { marginTop: 20, paddingHorizontal: 24, fontSize: 13, lineHeight: 18, color: colors.zinc500 },
});
