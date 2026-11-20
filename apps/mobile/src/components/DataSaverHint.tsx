import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { dataSaverMode, onCellular, setDataSaverMode, startDataSaver } from '@/lib/dataSaver';
import { DATA_SAVER_HINT_KEY, shouldHintSaver } from '@/lib/dataSaverRules';
import { kvGet, kvSet } from '@/lib/kv';
import { cardShadow, colors } from '@/lib/theme';
import { showToast } from '@/lib/toast';
import { t } from '@/lib/i18n';

/**
 * «Estás nos dados móveis»: uma só vez, no Início, a quem tem o «Poupar megas» desligado e está nos dados móveis.
 * «Ligar» escolhe «Só nos dados móveis» (no Wi-Fi tudo fica igual).
 */
export function DataSaverHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    startDataSaver();
    // Dá tempo de ler o modo guardado e o tipo de rede.
    const id = setTimeout(() => {
      void kvGet(DATA_SAVER_HINT_KEY).then((seen) => setShow(shouldHintSaver(dataSaverMode(), { cellular: onCellular(), saveData: false }, !!seen)));
    }, 2500);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  const done = (turnOn: boolean) => {
    setShow(false);
    void kvSet(DATA_SAVER_HINT_KEY, '1');
    if (turnOn) { void setDataSaverMode('mobile'); showToast(t('Poupar megas ligado nos dados móveis')); }
  };
  return (
    <View style={[st.card, cardShadow]}>
      <View style={st.row}>
        <View style={st.icon}><Icon name="bolt" size={20} color={colors.brand} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.title}>{t('Estás nos dados móveis')}</Text>
          <Text style={st.text}>{t('Liga o Poupar megas: fotos mais leves e os vídeos só descarregam quando lhes tocas. No Wi-Fi fica tudo igual.')}</Text>
        </View>
      </View>
      <View style={st.actions}>
        <Pressable onPress={() => done(false)} style={st.ghost} accessibilityRole="button"><Text style={st.ghostText}>{t('Agora não')}</Text></Pressable>
        <Pressable onPress={() => done(true)} style={st.primary} accessibilityRole="button"><Text style={st.primaryText}>{t('Ligar')}</Text></Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 16, borderRadius: 24, backgroundColor: colors.white, padding: 16 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  text: { marginTop: 2, fontSize: 14, lineHeight: 19, color: colors.zinc600 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  ghost: { height: 40, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc600 },
  primary: { height: 40, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand },
  primaryText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
