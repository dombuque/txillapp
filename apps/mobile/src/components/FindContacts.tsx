import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { FollowButton } from '@/components/FollowButton';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { pushApi, type ContactMatch } from '@/lib/api.settings';
import { canPickContacts, chooseContactsFile, emailsFromFile, hashAll, pickContactEmails } from '@/lib/contacts';
import { colors } from '@/lib/theme';


/**
 * "Amigos nos contactos": a pessoa escolhe os contactos (ou importa um ficheiro) e vê quem já está no Txillapp.
 * Os contactos ficam no telemóvel: só se envia o resumo dos emails, e nada disso fica guardado no servidor.
 */
export function FindContacts({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [found, setFound] = useState<ContactMatch[] | null>(null);
  const [total, setTotal] = useState(0);

  async function run(get: () => Promise<string[]>) {
    setBusy(true);
    setErr('');
    try {
      const emails = await get();
      setTotal(emails.length);
      setFound(emails.length ? await pushApi.matchContacts(await hashAll(emails)) : []);
    } catch (e) {
      // Cancelar o seletor do sistema não é um erro.
      if ((e as Error).name !== 'AbortError' && (e as Error).name !== 'NotAllowedError') setErr((e as Error).message);
    }
    setBusy(false);
  }
  async function importFile() {
    const f = await chooseContactsFile();
    if (f) void run(() => emailsFromFile(f));
  }

  return (
    <Sheet title="Amigos nos contactos" onClose={onClose} full>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        {found === null ? (
          <View style={{ gap: 12 }}>
            <Text style={st.p}>Vê quem dos teus contactos já está no Txillapp. Os contactos ficam no teu telemóvel: só enviamos um resumo cifrado dos emails, só para comparar, e não guardamos nada.</Text>
            {canPickContacts() ? (
              <>
                <Pressable onPress={() => void run(pickContactEmails)} disabled={busy} style={[st.primary, busy && { opacity: 0.5 }]} accessibilityRole="button">
                  <Icon name="users" size={20} color="#fff" />
                  <Text style={st.primaryText}>{busy ? 'A procurar…' : 'Permitir acesso aos contactos'}</Text>
                </Pressable>
                <Text style={st.small}>O telemóvel vai pedir a tua permissão e mostrar os contactos: escolhe os que quiseres (ou todos).</Text>
              </>
            ) : (
              <View style={st.box}>
                <Text style={{ fontWeight: '600', fontSize: 14, color: colors.zinc900 }}>Neste aparelho a app web não pode ler os contactos.</Text>
                <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc700 }}>No iPhone isso só é possível na app da App Store, que vai pedir a permissão normal. Enquanto isso, podes importar um ficheiro de contactos (.vcf).</Text>
                <Pressable onPress={() => void importFile()} disabled={busy} style={[st.import, busy && { opacity: 0.5 }]} accessibilityRole="button">
                  <Icon name="download" size={18} color={colors.zinc800} />
                  <Text style={{ fontWeight: '600', fontSize: 15, color: colors.zinc800 }}>{busy ? 'A procurar…' : 'Importar ficheiro de contactos'}</Text>
                </Pressable>
                <Text style={{ marginTop: 8, fontSize: 12, color: colors.zinc500 }}>Na app Contactos do iPhone, escolhe os contactos, toca em Partilhar e guarda o ficheiro .vcf.</Text>
              </View>
            )}
            {err ? <Text style={{ textAlign: 'center', fontSize: 14, color: colors.red600 }} accessibilityRole="alert">{err}</Text> : null}
          </View>
        ) : found.length === 0 ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <Text style={{ fontWeight: '800', fontSize: 16, color: colors.zinc600 }}>Ninguém por agora</Text>
            <Text style={{ marginTop: 4, fontSize: 14, color: colors.zinc600, textAlign: 'center' }}>{total ? `Vimos ${total} ${total === 1 ? 'email' : 'emails'} e nenhum está no Txillapp (ou ainda não quer ser encontrado).` : 'Não encontrámos emails nos contactos.'}</Text>
            <Pressable onPress={() => setFound(null)} style={st.again} accessibilityRole="button"><Text style={{ fontWeight: '600', fontSize: 16, color: colors.zinc900 }}>Tentar outra vez</Text></Pressable>
          </View>
        ) : (
          found.map((p) => (
            <View key={p.username} style={st.person}>
              <Pressable onPress={() => { onClose(); router.push({ pathname: '/u/[username]', params: { username: p.username } } as never); }} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }} accessibilityRole="link">
                <Avatar name={p.displayName} username={p.username} size={46} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }} numberOfLines={1}>{p.displayName}</Text>
                  <Text style={{ fontSize: 14, color: colors.zinc500 }} numberOfLines={1}>@{p.username} · {p.reason}</Text>
                </View>
              </Pressable>
              <View style={{ width: 104 }}><FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} /></View>
            </View>
          ))
        )}
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  p: { fontSize: 15, lineHeight: 22, color: colors.zinc700 },
  small: { fontSize: 14, color: colors.zinc500 },
  primary: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.brand },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  box: { borderRadius: 16, backgroundColor: '#fafafa', padding: 16 },
  import: { marginTop: 12, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.zinc200 },
  again: { marginTop: 16, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
