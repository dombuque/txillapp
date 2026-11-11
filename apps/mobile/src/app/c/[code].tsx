import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StickerArt } from '@/components/Stickers';
import { Wordmark } from '@/components/Wordmark';
import { api, inviteStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { INVITE_PHRASES, PHRASE_STICKERS, phraseIndexOf } from '@/lib/inviteCard';
import { stickerById } from '@/lib/stickers';
import { colors } from '@/lib/theme';

/**
 * A página do convite (txillapp.com/c/CÓDIGO): o que vê quem abre a ligação. «{Nome} convidou-te para o Txillapp», a foto,
 * a frase, os itens da Geleira que a pessoa mostra a todos, e os botões para criar conta (o código fica guardado até o
 * registo acabar). Abre-se sem sessão. Os robôs do WhatsApp recebem do servidor as meta tags com o cartão.
 */
export default function InviteLanding() {
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['invite-preview', code], queryFn: () => api.invitePreview(code), enabled: code.length >= 4, retry: false, staleTime: 60_000 });
  const p = q.data;
  const i = phraseIndexOf(code);
  const phrase = p?.phrase ?? INVITE_PHRASES[i];
  const sticker = stickerById(PHRASE_STICKERS[i]);

  // O código fica guardado: se a pessoa sair e voltar ao registo mais tarde, o convite continua a contar.
  useEffect(() => {
    if (p && !user) void inviteStore.set(code);
  }, [p, user, code]);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.title = p ? `${p.displayName} convidou-te para o Txillapp` : 'Convite para o Txillapp';
  }, [p]);

  const join = () => router.push((p ? `/register?convite=${encodeURIComponent(code)}` : '/register') as never);

  return (
    <LinearGradient colors={[colors.brand, '#ff8a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[st.page, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}>
        <View accessible accessibilityRole="image" accessibilityLabel="Txillapp"><Wordmark height={34} color="#ffffff" /></View>
        {q.isLoading && <ActivityIndicator style={{ marginTop: 60 }} color="#ffffff" />}
        {!q.isLoading && !p && (
          <View style={st.card}>
            <Text style={st.title} accessibilityRole="header">Este convite já não está ativo</Text>
            <Text style={st.text}>Mas podes entrar na mesma: o Txillapp é a rede da malta.</Text>
          </View>
        )}
        {p && (
          <View style={st.card}>
            <View style={{ alignItems: 'center' }}>
              <View style={st.ring}><Avatar username={p.hasAvatar === false ? undefined : p.username} name={p.displayName} size={112} /></View>
              {sticker && <View style={st.sticker} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><StickerArt def={sticker} size={86} /></View>}
            </View>
            <Text style={st.title} accessibilityRole="header">{p.displayName} convidou-te para o Txillapp</Text>
            <Text style={st.phrase}>{phrase}</Text>
            {p.items?.length ? (
              <View style={{ marginTop: 14, alignItems: 'center' }} accessible accessibilityLabel={`Na geleira de ${p.displayName}: ${p.items.join(', ')}`}>
                <Text style={st.label}>Na geleira de {p.displayName.split(' ')[0]}</Text>
                <View style={st.chips}>
                  {p.items.map((t) => <Text key={t} style={st.chip}>{t}</Text>)}
                </View>
              </View>
            ) : null}
            {p.reward ? <Text style={st.gift}>Entra com o convite e ganhas {p.reward} Txills logo à entrada.</Text> : null}
            <Text style={st.code} accessibilityLabel={`Código do convite: ${code.split('').join(' ')}`}>Código {code}</Text>
          </View>
        )}
        {!q.isLoading && (
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 20, maxWidth: 420, width: '100%' }}>
            {user ? (
              <Pressable onPress={() => router.replace('/')} style={[st.btn, { backgroundColor: '#ffffff' }]} accessibilityRole="button" accessibilityLabel="Já tens conta: abrir o Txillapp">
                <Text style={[st.btnText, { color: colors.brand }]}>Já tens conta: abrir o Txillapp</Text>
              </Pressable>
            ) : (
              <>
                <Pressable onPress={join} style={[st.btn, { backgroundColor: '#ffffff' }]} accessibilityRole="button" accessibilityLabel="Criar conta">
                  <Text style={[st.btnText, { color: colors.brand }]}>Criar conta</Text>
                </Pressable>
                <Pressable onPress={() => router.push('/login' as never)} style={[st.btn, { backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' }]} accessibilityRole="button" accessibilityLabel="Já tenho conta">
                  <Text style={[st.btnText, { color: '#ffffff' }]}>Já tenho conta</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const st = StyleSheet.create({
  page: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20 },
  card: { marginTop: 28, alignSelf: 'stretch', maxWidth: 420, width: '100%', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 28, paddingHorizontal: 20, paddingVertical: 24, boxShadow: '0 10px 30px rgba(0,0,0,0.18)' },
  ring: { borderRadius: 64, borderWidth: 4, borderColor: '#ffe4e8' },
  sticker: { position: 'absolute', right: -64, bottom: -10, transform: [{ rotate: '8deg' }] },
  title: { marginTop: 16, fontSize: 24, lineHeight: 30, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  phrase: { marginTop: 10, fontSize: 18, fontWeight: '800', color: colors.brand, textAlign: 'center' },
  text: { marginTop: 8, fontSize: 16, lineHeight: 22, color: colors.zinc600, textAlign: 'center' },
  label: { fontSize: 14, fontWeight: '700', color: colors.zinc500 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8 },
  chip: { overflow: 'hidden', borderRadius: 999, backgroundColor: colors.rose50, paddingHorizontal: 14, paddingVertical: 8, fontSize: 15, fontWeight: '700', color: colors.brand },
  gift: { marginTop: 16, fontSize: 16, lineHeight: 22, color: colors.zinc700, textAlign: 'center' },
  code: { marginTop: 10, fontSize: 15, fontWeight: '800', letterSpacing: 2, color: colors.zinc500 },
  btn: { minHeight: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnText: { fontSize: 17, fontWeight: '800' },
});
