import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { FollowButton } from '@/components/FollowButton';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { aiApi } from '@/lib/api.ai';
import { colors } from '@/lib/theme';
import { FeatureIntro } from './FeatureIntro';

/** O raio do SuperTxill, cheio (como o "bolt" do site com fill). */
/** O símbolo do SuperTxill (brilho), diferente do raio do Zás. */
export function Bolt({ size = 20, color = colors.brand }: { size?: number; color?: string }) {
  return <Icon name="sparkles" size={size} color={color} strokeWidth={2.2} />;
}

function BotAvatar({ size }: { size: number }) {
  return (
    <LinearGradient colors={[colors.brand, '#ff9a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Bolt size={Math.round(size * 0.5)} color="#fff" />
    </LinearGradient>
  );
}

/**
 * O SuperTxill: um ecrã da pilha (/supertxill), aberto a partir das Mensagens e da Pesquisa, só com dados do Txillapp.
 * Por ser um ecrã (e não uma janela por cima), arrastar para trás ou o «voltar» do browser volta para onde estavas.
 */
export function SuperTxillScreen({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const q = useQuery({ queryKey: ['supertxill-for-you'], queryFn: aiApi.forYou, staleTime: 60_000 });
  const list = q.data ?? [];
  // Procurar malta pelo nome ou pelo @ (a mesma pesquisa da lupa), com um pequeno atraso enquanto se escreve.
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim().replace(/^@/, '')), 250);
    return () => clearTimeout(t);
  }, [text]);
  const finding = term.length >= 2;
  const found = useQuery({ queryKey: ['search', term], queryFn: () => api.search(term), enabled: finding, staleTime: 30_000, placeholderData: keepPreviousData });
  const people = found.data?.people ?? [];

  return (
    <>
      <FeatureIntro id="supertxill" />
      <View style={{ flex: 1, backgroundColor: colors.white, alignItems: 'center' }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 576 }}>
          <View style={[s.header, { paddingTop: Math.max(12, insets.top) }]}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Voltar" style={s.back}><Icon name="chevron-left" size={26} /></Pressable>
            <BotAvatar size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.title}>SuperTxill</Text>
              <Text style={s.sub} numberOfLines={1}>Escolhido para ti, com o que se passa no Txillapp</Text>
            </View>
          </View>

          <View style={s.findWrap}>
            <View style={s.find}>
              <Icon name="search" size={18} color={colors.zinc500} />
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Procurar malta pelo nome ou @"
                placeholderTextColor={colors.zinc500}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={s.findInput}
                accessibilityLabel="Procurar malta"
              />
              {text ? (
                <Pressable onPress={() => setText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Limpar a pesquisa"><Icon name="x" size={18} color={colors.zinc500} /></Pressable>
              ) : null}
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(24, insets.bottom + 16) }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {finding ? (
              <>
                <Text style={s.h2}>Pessoas</Text>
                {found.isPending && <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />}
                {found.isError && !found.data && <Text accessibilityRole="alert" style={s.note}>Não consegui procurar agora. Tenta outra vez.</Text>}
                {found.isSuccess && people.length === 0 && <Text style={[s.note, { color: colors.zinc600, fontSize: 15 }]}>Ninguém com esse nome por aqui.</Text>}
                <View style={{ marginTop: 8 }}>
                  {people.map((p) => (
                    <View key={p.username} style={s.row}>
                      <Pressable onPress={() => router.push(`/u/${p.username}` as never)} style={s.who} accessibilityRole="button">
                        <Avatar name={p.displayName} username={p.username} size={48} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text style={s.name} numberOfLines={1}>{p.displayName}</Text>
                            {p.isPrivate && <Icon name="lock" size={14} color={colors.zinc500} />}
                          </View>
                          <Text style={s.reason} numberOfLines={1}>@{p.username}{p.followsYou ? ' · Segue-te' : ''}</Text>
                        </View>
                      </Pressable>
                      <View style={{ width: 104 }}>
                        <FollowButton username={p.username} following={p.following} requested={p.requested} isPrivate={p.isPrivate} />
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : (
            <>
            <Text style={s.h2}>Malta para ti</Text>
            {q.isLoading && <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />}
            {q.isError && <Text accessibilityRole="alert" style={s.note}>Não consegui ver agora. Tenta daqui a pouco.</Text>}
            {q.isSuccess && list.length === 0 && <Text style={[s.note, { color: colors.zinc600, fontSize: 15 }]}>Ainda não tenho malta para te mostrar. Segue algumas pessoas e põe gostos na tua geleira, e eu aprendo contigo.</Text>}
            <View style={{ marginTop: 8 }}>
              {list.map((p) => (
                <View key={p.username} style={s.row}>
                  <Pressable onPress={() => router.push(`/u/${p.username}` as never)} style={s.who} accessibilityRole="button">
                    <Avatar name={p.displayName} username={p.username} size={48} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={s.name} numberOfLines={1}>{p.displayName}</Text>
                        {p.isPrivate && <Icon name="lock" size={14} color={colors.zinc500} />}
                      </View>
                      <Text style={s.reason} numberOfLines={1}>{p.reason}</Text>
                    </View>
                  </Pressable>
                  <View style={{ width: 104 }}>
                    <FollowButton username={p.username} following={false} requested={p.requested} isPrivate={p.isPrivate} />
                  </View>
                </View>
              ))}
            </View>
            </>
            )}
            <Text style={s.box}>Isto é calculado pelo Txillapp, só com dados do Txillapp: quem segues e os gostos da tua geleira. Nada sai para fora. Só aparecem pessoas que aceitam ser sugeridas. Podes desligar o uso da geleira nas Definições.</Text>
          </ScrollView>
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.zinc100 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', lineHeight: 22, color: colors.zinc900 },
  sub: { fontSize: 12, color: colors.zinc500 },
  findWrap: { paddingHorizontal: 16, paddingTop: 12 },
  find: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 14 },
  findInput: { flex: 1, height: 44, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  h2: { fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  note: { marginTop: 24, textAlign: 'center', color: colors.zinc500, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 16, fontWeight: '600', color: colors.zinc900, flexShrink: 1 },
  reason: { fontSize: 14, color: colors.zinc500 },
  box: { marginTop: 24, borderRadius: 16, backgroundColor: '#fafafa', padding: 14, fontSize: 13, lineHeight: 18, color: colors.zinc600 },
});
