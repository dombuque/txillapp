import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { FindContacts } from '@/components/FindContacts';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/lib/auth';
import { nativeContacts } from '@/lib/contacts';
import { NUDGE_KEY, dismissNudge, nudgeMode, readNudge, type ContactsPermission } from '@/lib/contactsNudge';
import { kvGet, kvSet } from '@/lib/kv';
import { cardShadow, colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

async function permission(): Promise<ContactsPermission> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Contacts = require('expo-contacts') as typeof import('expo-contacts');
  const p = await Contacts.getPermissionsAsync();
  return { status: p.status === 'granted' ? 'granted' : p.status === 'denied' ? 'denied' : 'undetermined', canAskAgain: p.canAskAgain !== false };
}

/**
 * «Encontra amigos nos teus contactos» no Início (só na app instalada), para quem ainda não deu a permissão, de tempos a
 * tempos (lib/contactsNudge). «Procurar» abre «Amigos nos contactos», que explica e pede a permissão do sistema.
 */
export function ContactsNudge() {
  const { user } = useAuth();
  const [mode, setMode] = useState<'ask' | 'settings' | null>(null);
  const [open, setOpen] = useState(false);
  const check = useCallback(async () => {
    if (!nativeContacts || !user) return setMode(null);
    try {
      setMode(nudgeMode(readNudge(await kvGet(NUDGE_KEY)), await permission()));
    } catch {
      setMode(null);
    }
  }, [user]);
  useEffect(() => { void check(); }, [check]);
  if (!mode) return null;

  async function later() {
    const s = readNudge(await kvGet(NUDGE_KEY));
    await kvSet(NUDGE_KEY, JSON.stringify(dismissNudge(s, mode!)));
    setMode(null);
  }

  return (
    <View style={[st.card, cardShadow]} accessibilityLabel={t('Encontra amigos nos teus contactos')}>
      <View style={st.row}>
        <View style={st.icon}><Icon name="users" size={22} color={colors.brand} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.title}>{t('Encontra amigos nos teus contactos')}</Text>
          <Text style={st.text}>{mode === 'settings'
            ? t('Recusaste o acesso aos contactos. Se mudares de ideias, podes permiti-lo nas definições do telemóvel.')
            : t('Vê quem dos teus contactos já está no Txillapp. Os contactos ficam no telemóvel: só comparamos os emails cifrados.')}</Text>
        </View>
      </View>
      <View style={st.actions}>
        <Pressable onPress={() => void later()} style={st.ghost} accessibilityRole="button"><Text style={st.ghostText}>{t('Agora não')}</Text></Pressable>
        <Pressable
          onPress={() => { if (mode === 'settings') { void Linking.openSettings().catch(() => undefined); void later(); } else setOpen(true); }}
          style={st.primary}
          accessibilityRole="button"
        >
          <Text style={st.primaryText}>{mode === 'settings' ? t('Abrir as definições') : t('Procurar')}</Text>
        </Pressable>
      </View>
      {open ? <FindContacts onClose={() => { setOpen(false); void check(); }} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 16, borderRadius: 24, backgroundColor: colors.white, padding: 16 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  text: { marginTop: 2, fontSize: 14, lineHeight: 19, color: colors.zinc600 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  ghost: { height: 40, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc600 },
  primary: { height: 40, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand },
  primaryText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
