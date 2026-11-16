import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { SettingRow, SettingsSection } from '@/components/settings/SettingRow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { mixarControloApi, mixarControloKeys, type MixarPrivateTopics } from '@/lib/api.mixarControlo';
import { privateCountLabel, togglePrivate } from '@/lib/mixarControlo';
import { colors } from '@/lib/theme';

/**
 * Definições › Privacidade › «Temas privados no Mixar» (0172): os temas que nunca aparecem nos meus Mixar, nem na
 * compatibilidade, nem nos temas em comum, nem nas razões dos itens, nem no resumo da semana. Valem para todos os meus
 * Mixar; quem está comigo no Mixar não sabe quais são. Também se abre a partir dos temas do Mixar.
 */
export default function MixarPrivateTopicsScreen() {
  const qc = useQueryClient();
  const key = mixarControloKeys.privateTopics();
  const q = useQuery({ queryKey: key, queryFn: mixarControloApi.privateTopics });
  const [err, setErr] = useState('');
  const chosen = (q.data?.topics ?? []).map((t) => t.topic);

  async function toggle(topic: string, on: boolean) {
    if (!q.data) return;
    const before = q.data;
    const next = togglePrivate(chosen, topic, on);
    setErr('');
    qc.setQueryData<MixarPrivateTopics>(key, { ...before, topics: before.all.filter((t) => next.includes(t.topic)) });
    try {
      qc.setQueryData(key, await mixarControloApi.setPrivateTopics(next));
      // Os Mixar abertos (match, temas em comum, razões) mudam logo.
      void qc.invalidateQueries({ queryKey: ['mixar'] });
    } catch {
      qc.setQueryData(key, before);
      setErr('Não consegui guardar. Tenta outra vez.');
    }
  }

  return (
    <SettingsPage title="Temas privados no Mixar">
      <SettingsSection note="Os temas que escolheres nunca aparecem nos teus Mixar: não contam para a compatibilidade, não entram nos temas em comum nem nas razões («Porque gostas de…») e ficam fora do resumo da semana e da imagem que se partilha. Vale para todos os teus Mixar e a outra pessoa não sabe quais são. O teu feed normal não muda.">
        <Text style={st.count}>Privados: {privateCountLabel(chosen.length)}</Text>
      </SettingsSection>
      {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
      {q.isPending ? <ActivityIndicator style={{ margin: 24 }} color={colors.brand} /> : null}
      {q.isError ? <Text style={st.err}>Não consegui abrir os temas. Tenta outra vez daqui a pouco.</Text> : null}
      {q.data ? (
        <SettingsSection title="Temas">
          {q.data.all.map((t) => (
            <SettingRow key={t.topic} icon={chosen.includes(t.topic) ? 'lock' : 'tag'} title={t.label} toggle={{ on: chosen.includes(t.topic), onChange: (v) => void toggle(t.topic, v) }} />
          ))}
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}

const st = StyleSheet.create({
  count: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, fontWeight: '700', color: colors.zinc800 },
  err: { marginHorizontal: 16, marginTop: 8, fontSize: 14, color: colors.red600 },
});
