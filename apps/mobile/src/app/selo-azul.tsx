import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ActivityIndicator } from '@/components/PontoLoader';
import { StackPage } from '@/components/StackPage';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { iapCatalogKey } from '@/lib/api.iap';
import { CHANNEL } from '@/lib/distribution';
import { iap } from '@/lib/iap';
import { doneMessage, iapMessage, outcomeMessage, type IapOutcome, type StoreProduct } from '@/lib/iap/core';
import { BLUE_BENEFITS, PRIVACY_URL, TERMS_URL, activeText, blueScreenState, periodLabel, periodTitle, storeName, subscriptionTerms } from '@/lib/iap/view';
import { ASK_IAP, IAP_PLATFORM, useIapCatalog } from '@/lib/purchases';
import { colors } from '@/lib/theme';

/**
 * «Verificação com selo azul»: a verificação paga, uma subscrição da App Store ou do Google Play. Só nas versões das lojas,
 * com IAP_READY e o catálogo ligado no servidor. Mostra o que dá, o preço e o período que a loja diz, as condições
 * (renova sozinha, como se cancela, Termos e Privacidade: App Store 3.1.2), e os botões Subscrever, Restaurar compras e
 * Gerir subscrição. Quem ainda não foi verificado pede primeiro a verificação (/verification).
 */
export default function BlueSeal() {
  const router = useRouter();
  const qc = useQueryClient();
  const catalog = useIapCatalog();
  const c = catalog.data;
  const state = ASK_IAP ? blueScreenState(CHANNEL, c, catalog.isLoading) : 'hidden';
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'buy' | 'restore'>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = c?.verification.products.map((p) => p.id).join(',') ?? '';

  // Ao abrir: tenta outra vez as compras que ficaram por confirmar, e pede os preços à loja.
  useEffect(() => {
    if (state !== 'offer' && state !== 'active') return;
    let gone = false;
    void iap.recover().catch(() => undefined);
    if (state === 'offer' && ids) {
      iap.products(ids.split(','), 'subs').then(
        (list) => {
          if (gone) return;
          setProducts(list);
          setPick((p) => p ?? list[0]?.id ?? null);
        },
        () => !gone && setProducts([]),
      );
    }
    return () => {
      gone = true;
    };
  }, [state, ids]);

  if (state === 'hidden') return <Redirect href={'/verification' as never} />;
  const platform = IAP_PLATFORM!;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: iapCatalogKey(platform) }), qc.invalidateQueries({ queryKey: ['verification'] })]);

  const show = (o: IapOutcome) => {
    if (o.status === 'done') setMsg(doneMessage(o.entitlement, 'Feito! O teu selo azul já está ativo.'));
    else {
      const text = outcomeMessage(o);
      setMsg(text ? { ok: o.status === 'pending', text } : null);
    }
  };

  const subscribe = async () => {
    if (!pick || busy) return;
    setBusy('buy');
    setMsg(null);
    const o = await iap.subscribe(pick);
    show(o);
    if (o.status === 'done') await refresh();
    setBusy(null);
  };
  const restore = async () => {
    if (busy) return;
    setBusy('restore');
    setMsg(null);
    const r = await iap.restore();
    if (r.ok) {
      await refresh();
      setMsg({ ok: true, text: 'Compras restauradas. Se tinhas uma subscrição ativa nesta conta da loja, o selo azul volta.' });
    } else setMsg({ ok: false, text: r.code === 503 ? 'As compras pela loja estão em pausa. Tenta outra vez mais tarde.' : r.code === 502 ? 'A loja não respondeu. Tenta outra vez daqui a pouco.' : (r.kind === 'failed' ? null : iapMessage(r.kind ?? 'failed')) ?? 'Não deu para restaurar agora. Tenta outra vez.' });
    setBusy(null);
  };
  const manage = () => void iap.manage(c?.verification.active?.productId ?? pick ?? undefined).catch(() => setMsg({ ok: false, text: iapMessage('unavailable')! }));

  const period = (id: string) => c?.verification.products.find((p) => p.id === id)?.period ?? 'month';

  return (
    <StackPage title="Selo azul">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 16 }}>
        <View style={st.hero}>
          <VerifiedBadge size={56} tier="paid" />
          <Text style={st.heroTitle}>Verificação com selo azul</Text>
          <Text style={st.heroSub}>O selo azul mostra que a conta foi verificada e que és tu a mantê-la, com uma subscrição.</Text>
        </View>

        {state === 'loading' ? <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} /> : null}

        {state === 'not-eligible' ? (
          <View style={st.box}>
            <Text style={st.boxTitle}>Primeiro, pede a verificação</Text>
            <Text style={st.text}>O selo azul é para contas já verificadas. Pede a verificação (requisitos da conta, documento e selfie, revistos pela moderação). Depois de aprovada, voltas aqui e ativas o selo azul.</Text>
            <Pressable onPress={() => router.push('/verification' as never)} style={st.ghost} accessibilityRole="link">
              <Text style={st.ghostText}>Pedir a verificação</Text>
            </Pressable>
          </View>
        ) : null}

        {state === 'active' && c?.verification.active ? (
          <View style={[st.box, { backgroundColor: '#eff6ff' }]}>
            <Text style={st.boxTitle}>Subscrição ativa</Text>
            <Text style={st.text}>{activeText(c.verification.active)}</Text>
          </View>
        ) : null}

        {state === 'offer' || state === 'active' || state === 'not-eligible' ? (
          <View style={{ gap: 8 }}>
            <Text style={st.label}>O que tens</Text>
            {BLUE_BENEFITS.map((b) => (
              <View key={b} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Icon name="check" size={18} color="#1d9bf0" />
                <Text style={[st.text, { flex: 1 }]}>{b}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {state === 'offer' ? (
          <View style={{ gap: 10 }}>
            <Text style={st.label}>Escolhe o plano</Text>
            {products == null ? <ActivityIndicator color={colors.brand} /> : null}
            {products && !products.length ? <Text style={st.text}>A {storeName(platform)} não mostrou os planos agora. Tenta outra vez daqui a pouco.</Text> : null}
            <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
              {(products ?? []).map((p) => {
                const on = pick === p.id;
                const per = period(p.id);
                return (
                  <Pressable key={p.id} onPress={() => setPick(p.id)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${periodTitle(per)}: ${p.price} ${periodLabel(per)}, renova automaticamente`} style={[st.plan, on && st.planOn]}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.planTitle}>{periodTitle(per)}</Text>
                      <Text style={st.small}>Renova automaticamente</Text>
                    </View>
                    <Text style={st.planPrice}>{p.price} <Text style={st.small}>{periodLabel(per)}</Text></Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => void subscribe()} disabled={!pick || !!busy} style={[st.cta, (!pick || !!busy) && { opacity: 0.5 }]} accessibilityRole="button">
              {busy === 'buy' ? <ActivityIndicator color="#fff" /> : <Text style={st.ctaText}>Subscrever</Text>}
            </Pressable>
          </View>
        ) : null}

        {msg ? <Text accessibilityRole="alert" style={{ textAlign: 'center', fontSize: 14, lineHeight: 20, color: msg.ok ? colors.green700 : colors.red600 }}>{msg.text}</Text> : null}

        {state === 'offer' || state === 'active' ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => void restore()} disabled={!!busy} style={[st.ghost, { flex: 1, alignSelf: 'auto' }]} accessibilityRole="button">
                <Text style={st.ghostText}>{busy === 'restore' ? 'A restaurar…' : 'Restaurar compras'}</Text>
              </Pressable>
              <Pressable onPress={manage} style={[st.ghost, { flex: 1, alignSelf: 'auto' }]} accessibilityRole="button">
                <Text style={st.ghostText}>Gerir subscrição</Text>
              </Pressable>
            </View>
            <View style={{ gap: 6 }}>
              {subscriptionTerms(platform).map((t) => <Text key={t} style={st.small}>{t}</Text>)}
              <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
                <Pressable onPress={() => void Linking.openURL(TERMS_URL)} accessibilityRole="link"><Text style={st.link}>Termos de Utilização</Text></Pressable>
                <Pressable onPress={() => void Linking.openURL(PRIVACY_URL)} accessibilityRole="link"><Text style={st.link}>Política de Privacidade</Text></Pressable>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 24, backgroundColor: '#eff6ff', padding: 24, alignItems: 'center', gap: 6 },
  heroTitle: { marginTop: 6, fontSize: 20, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  heroSub: { fontSize: 14, lineHeight: 20, color: colors.zinc600, textAlign: 'center' },
  box: { borderRadius: 16, backgroundColor: '#fafafa', padding: 16, gap: 6 },
  boxTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  label: { fontSize: 13, fontWeight: '700', color: colors.zinc500, textTransform: 'uppercase', letterSpacing: 0.5 },
  text: { fontSize: 15, lineHeight: 21, color: colors.zinc700 },
  small: { fontSize: 12, lineHeight: 17, color: colors.zinc500, fontWeight: '400' },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, padding: 14 },
  planOn: { borderColor: '#1d9bf0', backgroundColor: '#eff6ff' },
  planTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  planPrice: { fontSize: 17, fontWeight: '800', color: colors.zinc900 },
  cta: { height: 52, borderRadius: 999, backgroundColor: '#1d9bf0', alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  ghost: { alignSelf: 'flex-start', minHeight: 44, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 14, fontWeight: '600', color: colors.zinc800 },
  link: { fontSize: 13, fontWeight: '600', color: colors.brand, textDecorationLine: 'underline' },
});
