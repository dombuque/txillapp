import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Group } from '@/components/Lines';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LANGS, currentLanguage, localeOf, setLanguage, t, type Lang } from '@/lib/i18n';
import { colors } from '@/lib/theme';

/**
 * Idiomas (docs/idiomas.md): a lista de LANGS, cada um com o nome no próprio idioma e o escolhido com visto. Tocar guarda
 * neste aparelho e na conta (PATCH /users/me { language }) e recarrega a app já no idioma novo. Igual em todas as versões.
 */
export default function Languages() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const current = currentLanguage();

  const choose = async (lang: Lang) => {
    if (lang === current || busy) return;
    setBusy(true);
    // Na conta, para os pushes e os e-mails saírem no idioma certo. Sem rede, fica só neste aparelho (não prende a mudança).
    if (user) await Promise.race([api.updateMe({ language: lang }).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
    setLanguage(lang);
    setBusy(false);
  };

  return (
    <StackPage title={t('Idiomas')}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Group title={t('Idioma da app')}>
          {LANGS.map((l) => {
            const on = l.code === current;
            return (
              <Pressable key={l.code} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: busy }} accessibilityLanguage={localeOf(l.code)} onPress={() => void choose(l.code)} style={({ pressed }) => [st.row, pressed && !on ? st.pressed : null]}>
                <Text style={st.label}>{l.name}</Text>
                <View style={[st.radio, on ? { borderColor: colors.brand, backgroundColor: colors.brand } : null]}>{on ? <Icon name="check" size={14} strokeWidth={3} color="#fff" /> : null}</View>
              </Pressable>
            );
          })}
        </Group>
        <Text style={st.foot}>{t('Ao mudar de idioma, a app recarrega já no idioma escolhido.')}</Text>
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  pressed: { backgroundColor: colors.zinc50 },
  label: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  foot: { marginHorizontal: 24, marginTop: 20, textAlign: 'center', fontSize: 14, color: colors.zinc500 },
});
