import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { FridgeArt, geleiraLevel, geleiraPoints } from '@/components/FridgeArt';
import { GeleiraPostCard } from '@/components/GeleiraPostCard';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { ApiError, api } from '@/lib/api';
import { composeApi } from '@/lib/api.compose';
import { geleiraApi, type PostGeleira } from '@/lib/api.geleira';
import { useAuth } from '@/lib/auth';
import { shareBlockReason, visibilityNote } from '@/lib/geleiraPost';
import { goBack } from '@/lib/nav';
import { colors } from '@/lib/theme';

/**
 * «Partilhar a minha geleira» (0143): o ecrã de publicar já com o cartão da geleira e uma legenda opcional. O servidor tira o
 * retrato dos gostos no momento de publicar (a ordem, os nomes e o desenho); o post não muda se a geleira mudar depois. O
 * cartão mostra o que quem vê vai ver: as bebidas alcoólicas só aparecem a quem tem 18 anos ou mais.
 */
export default function PartilharGeleira() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const mine = useQuery({ queryKey: ['geleira', 'me'], queryFn: geleiraApi.mine, retry: false });
  const level = useQuery({ queryKey: ['geleira-level', user?.username ?? ''], queryFn: () => geleiraApi.level(user!.username), enabled: !!user, retry: false, staleTime: 60_000 });
  const settings = useQuery({ queryKey: ['geleira-settings'], queryFn: geleiraApi.settings, retry: false, staleTime: 60_000 });
  const profile = useQuery({ queryKey: ['profile', user?.username], queryFn: () => api.profile(user!.username), enabled: !!user, retry: false, staleTime: 60_000 });

  // O retrato que vai sair (a mesma ordem do perfil e do servidor: favoritos, nota, os mais recentes).
  const items = (mine.data ?? []).filter((i) => !i.pending && (i.kind === 'bebida' || i.kind === 'comida'));
  const why = mine.isSuccess ? shareBlockReason(mine.data) : null;
  const preview: PostGeleira = {
    level: level.data?.level ?? geleiraLevel(geleiraPoints(items)),
    total: items.length,
    items: items.map((i) => ({ id: i.id, slug: i.slug, name: i.name, kind: i.kind, category: i.category, alcoholic: i.alcoholic, favorite: i.favorite, rating: i.rating, cheers: i.cheers ?? 0, cheered: false })),
  };
  const alcohol = items.some((i) => i.alcoholic);
  const note = visibilityNote(settings.data?.visibility, !!profile.data?.isPrivate);
  const canPost = !busy && mine.isSuccess && !why && !!user;
  const left = 2000 - body.length;

  async function publish() {
    if (!canPost) return;
    setBusy(true);
    setErr('');
    try {
      const p = await composeApi.createPost({ body: body.trim(), mediaIds: [], geleira: true });
      void Promise.all([qc.invalidateQueries({ queryKey: ['feed'] }), qc.invalidateQueries({ queryKey: ['profile-posts'] })]);
      router.replace(`/p/${(p as { code?: string; id: string }).code ?? (p as { id: string }).id}` as never);
    } catch (e) {
      setErr(e instanceof ApiError && e.message ? e.message : 'Não consegui publicar agora. Tenta outra vez.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }} behavior="padding">
      <View style={st.top}>
        <Pressable onPress={() => goBack(router, '/profile')} style={st.x} accessibilityRole="button" accessibilityLabel="Cancelar"><Icon name="x" size={24} strokeWidth={2} /></Pressable>
        <Text style={st.title}>Partilhar a geleira</Text>
        <Pressable onPress={() => void publish()} disabled={!canPost} style={[st.publish, !canPost && { backgroundColor: 'rgba(214,51,79,0.4)' }]} accessibilityRole="button" accessibilityState={{ disabled: !canPost }}>
          {busy ? <ActivityIndicator color="#fff" size="small" style={{ height: 28 }} /> : <Text style={st.publishText}>Publicar</Text>}
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) }} showsVerticalScrollIndicator={false}>
        {mine.isLoading ? (
          <View style={[st.card, { height: 360, alignItems: 'center', justifyContent: 'center' }]} accessibilityLabel="A carregar a geleira"><ActivityIndicator color={colors.brand} /></View>
        ) : mine.isError ? (
          <View style={[st.card, st.empty]} accessibilityRole="alert">
            <Text style={st.emptyText}>Não consegui abrir a tua geleira.</Text>
            <Pressable onPress={() => void mine.refetch()} style={st.ghostBtn} accessibilityRole="button"><Text style={st.ghostText}>Tentar outra vez</Text></Pressable>
          </View>
        ) : why ? (
          // Geleira vazia: não se partilha, e diz-se porquê (e como a encher).
          <View style={[st.card, st.empty]}>
            <FridgeArt count={0} level={0} invite size={84} />
            <Text style={st.emptyTitle}>Ainda não há o que partilhar</Text>
            <Text style={st.emptyText}>{why}</Text>
            <Pressable onPress={() => router.replace('/geleira' as never)} style={st.fill} accessibilityRole="button"><Text style={st.fillText}>Encher a geleira</Text></Pressable>
          </View>
        ) : (
          <View style={st.card}>
            <View style={st.who}>
              <Avatar name={user?.displayName ?? '?'} username={user?.username} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.name} numberOfLines={1}>{user?.displayName}</Text>
                <Text style={st.handle} numberOfLines={1}>@{user?.username}</Text>
              </View>
            </View>
            <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="Diz alguma coisa sobre a tua geleira (opcional)"
                placeholderTextColor={colors.zinc500}
                multiline
                maxLength={2000}
                style={st.input}
                accessibilityLabel="Legenda (opcional)"
              />
              {left < 200 ? <Text style={[st.left, left < 50 && { color: colors.brand, fontWeight: '600' }]} accessibilityLiveRegion="polite">{left}</Text> : null}
            </View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              {user ? <GeleiraPostCard post={{ id: 'preview', author: { id: user.id, username: user.username, displayName: user.displayName }, geleira: preview } as never} me={user.id} preview /> : null}
              <View style={st.notes}>
                <View style={st.noteRow}>
                  <Icon name="snowflake" size={16} color="#0369a1" />
                  <Text style={st.noteText}>O post leva a tua geleira tal como está agora. Se a mudares depois, o post fica igual, com a ligação para a geleira de agora.</Text>
                </View>
                <View style={st.noteRow}>
                  <Icon name="cheers" size={16} color={colors.amber600} />
                  <Text style={st.noteText}>Quem vir o post pode brindar a cada gosto: os brindes contam também na geleira do teu perfil.</Text>
                </View>
                {alcohol ? (
                  <View style={st.noteRow}>
                    <Icon name="lock" size={16} color={colors.zinc600} />
                    <Text style={st.noteText}>As bebidas com álcool só aparecem a quem tem 18 anos ou mais.</Text>
                  </View>
                ) : null}
                {note ? (
                  <View style={st.noteRow}>
                    <Icon name="eye" size={16} color={colors.zinc600} />
                    <Text style={st.noteText}>{note}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        )}
        {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4 },
  x: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  title: { fontSize: 18, fontWeight: '700', color: colors.zinc900 },
  publish: { height: 40, minWidth: 96, borderRadius: 20, backgroundColor: colors.brand, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' },
  publishText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  card: { marginHorizontal: 16, borderRadius: 28, backgroundColor: colors.white, boxShadow: '0 2px 16px rgba(0,0,0,0.09)', overflow: 'hidden' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 20 },
  name: { fontSize: 18, fontWeight: '600', color: colors.zinc900 },
  handle: { fontSize: 14, color: colors.zinc500 },
  input: { minHeight: 72, fontSize: 18, lineHeight: 26, color: colors.zinc900, textAlignVertical: 'top', padding: 0, outlineStyle: 'none' } as object,
  left: { textAlign: 'right', fontSize: 12, color: colors.zinc500 },
  notes: { marginTop: 14, gap: 10 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  empty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 28, gap: 8 },
  emptyTitle: { marginTop: 8, fontSize: 18, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  emptyText: { fontSize: 15, lineHeight: 22, color: colors.zinc600, textAlign: 'center' },
  fill: { marginTop: 8, height: 48, borderRadius: 24, backgroundColor: colors.brand, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  fillText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  ghostBtn: { marginTop: 8, height: 44, paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
  err: { marginTop: 16, paddingHorizontal: 24, textAlign: 'center', fontSize: 16, color: colors.red600 },
});
