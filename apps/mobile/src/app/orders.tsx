import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Group, Line } from '@/components/Lines';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { extraApi, newKey, type PaymentOrder } from '@/lib/api.extra';
import { colors } from '@/lib/theme';

/** Como na versão das lojas do site: sem métodos de pagamento ativos não se mostra nada de "em breve" na app nativa. */
const STORE_BUILD = Platform.OS !== 'web';

const n = (v: number) => v.toLocaleString('pt-PT');
const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2).replace('.', ',')} ${currency === 'MZN' ? 'MT' : currency}`;
const STATUS: Record<PaymentOrder['status'], { label: string; bg: string; fg: string }> = {
  pending: { label: 'À espera', bg: '#fef3c7', fg: '#92400e' },
  paid: { label: 'Pago', bg: '#d1fae5', fg: '#065f46' },
  failed: { label: 'Falhou', bg: '#fee2e2', fg: '#b91c1c' },
  cancelled: { label: 'Cancelado', bg: colors.zinc100, fg: colors.zinc600 },
  expired: { label: 'Expirou', bg: colors.zinc100, fg: colors.zinc600 },
};
const date = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/** Pedidos e pagamentos: o saldo, recarregar Txills e o histórico de pedidos. */
export default function Orders() {
  const qc = useQueryClient();
  const router = useRouter();
  const w = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  const cfg = useQuery({ queryKey: ['payments-config'], queryFn: extraApi.paymentsConfig, staleTime: 5 * 60_000 });
  const orders = useQuery({ queryKey: ['payments-orders'], queryFn: extraApi.paymentsOrders });
  const [pkg, setPkg] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [current, setCurrent] = useState<PaymentOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const key = useRef(newKey());
  const providers = cfg.data?.providers ?? [];
  const chosen = providers.find((p) => p.id === (provider ?? providers[0]?.id));
  const chosenPkg = cfg.data?.packages.find((p) => p.id === pkg);

  // Enquanto o pedido está à espera, pergunta ao servidor de 3 em 3 segundos; ao ser pago, atualiza o saldo.
  useEffect(() => {
    if (!current || current.status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        const o = await extraApi.paymentsOrder(current.id);
        if (o.status !== 'pending') {
          setCurrent(o);
          void qc.invalidateQueries({ queryKey: ['wallet'] });
          void qc.invalidateQueries({ queryKey: ['payments-orders'] });
        }
      } catch {
        /* tenta no próximo */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [current, qc]);

  async function pay() {
    if (!chosen || !chosenPkg) return;
    setBusy(true);
    setErr('');
    try {
      const o = await extraApi.paymentsCreate({ packageId: chosenPkg.id, provider: chosen.id, phone: chosen.needsPhone ? phone : undefined }, key.current);
      setCurrent(o);
      key.current = newKey(); // o próximo pedido é outro
      void qc.invalidateQueries({ queryKey: ['payments-orders'] });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }
  async function cancel() {
    if (!current) return;
    try {
      await extraApi.paymentsCancel(current.id);
      setCurrent(await extraApi.paymentsOrder(current.id));
      void qc.invalidateQueries({ queryKey: ['payments-orders'] });
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function sandboxPay() {
    if (!current) return;
    setBusy(true);
    try {
      setCurrent(await extraApi.paymentsSandboxPay(current.id));
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['payments-orders'] });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  const payDisabled = busy || !chosenPkg || (!!chosen?.needsPhone && phone.trim().length < 9);

  return (
    <StackPage title="Pedidos e pagamentos">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={[colors.brand, '#e8475f', '#ff8a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.balance}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.85)' }}>O teu saldo</Text>
          <Text style={{ marginTop: 4, fontSize: 38, fontWeight: '900', lineHeight: 38, color: '#fff' }}>
            {w.data ? n(w.data.balance) : '…'} <Text style={{ fontSize: 20, fontWeight: '700' }}>Txills</Text>
          </Text>
          <Pressable onPress={() => router.push('/wallet' as never)} accessibilityRole="button" style={({ pressed }) => [st.balBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>Ver movimentos e presentes</Text>
          </Pressable>
        </LinearGradient>

        {(!STORE_BUILD || providers.length > 0) && (
          <Group title="Recarregar Txills">
            {cfg.isLoading ? <ActivityIndicator style={{ margin: 24 }} color={colors.brand} /> : null}
            {cfg.data && providers.length === 0 && !STORE_BUILD ? <Line icon="wallet" label="Comprar Txills" value="Em breve: M-Pesa, e-Mola e cartão" /> : null}
            {cfg.data && providers.length > 0 && !current ? (
              <View style={{ padding: 16, gap: 16 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {cfg.data.packages.map((p) => (
                    <Pressable key={p.id} onPress={() => setPkg(p.id)} accessibilityRole="button" accessibilityState={{ selected: pkg === p.id }} style={({ pressed }) => [st.pkg, pkg === p.id && { borderColor: colors.brand, backgroundColor: colors.rose50 }, pressed && { transform: [{ scale: 0.98 }] }]}>
                      <Text style={{ fontSize: 22, fontWeight: '900', lineHeight: 22, color: colors.zinc900 }}>{n(p.txills)}</Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.zinc500 }}>Txills</Text>
                      <Text style={{ marginTop: 6, fontSize: 15, fontWeight: '600', color: colors.brand }}>{money(p.priceMinor, p.currency)}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
                  {providers.map((p) => (
                    <Pressable key={p.id} onPress={() => setProvider(p.id)} accessibilityRole="radio" accessibilityState={{ checked: chosen?.id === p.id }} style={[st.prov, chosen?.id === p.id && { borderColor: colors.brand, backgroundColor: colors.rose50 }]}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: chosen?.id === p.id ? colors.brand : colors.zinc700 }}>{p.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {chosen?.needsPhone ? (
                  <View>
                    <Text style={{ marginBottom: 6, fontSize: 14, fontWeight: '600', color: colors.zinc900 }}>O teu número {chosen.label}</Text>
                    <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="84 123 4567" placeholderTextColor={colors.zinc500} style={st.phone} />
                  </View>
                ) : null}
                {err ? <Text style={{ textAlign: 'center', fontSize: 14, color: colors.red600 }}>{err}</Text> : null}
                <Pressable onPress={() => void pay()} disabled={payDisabled} accessibilityRole="button" style={({ pressed }) => [st.primary, payDisabled && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.98 }] }]}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>{busy ? 'A preparar…' : chosenPkg ? `Pagar ${money(chosenPkg.priceMinor, chosenPkg.currency)}` : 'Escolhe um pacote'}</Text>
                </Pressable>
              </View>
            ) : null}
            {current ? (
              <View style={{ padding: 16, gap: 12, alignItems: 'stretch' }}>
                {current.status === 'pending' && (
                  <>
                    <Text style={st.stateTitle}>À espera do pagamento</Text>
                    <Text style={{ textAlign: 'center', fontSize: 14, color: colors.zinc600 }}>
                      {current.provider === 'sandbox' ? 'Pagamento de teste: confirma abaixo.' : `Confirma o pagamento no teu telemóvel${current.phoneTail ? ` (número terminado em ${current.phoneTail})` : ''}.`} Isto atualiza sozinho.
                    </Text>
                    {current.provider === 'sandbox' ? (
                      <Pressable onPress={() => void sandboxPay()} disabled={busy} style={[st.btn, { backgroundColor: '#10b981' }, busy && { opacity: 0.5 }]} accessibilityRole="button"><Text style={st.btnWhite}>Simular pagamento</Text></Pressable>
                    ) : null}
                    <Pressable onPress={() => void cancel()} style={st.btn} accessibilityRole="button"><Text style={{ fontWeight: '600', color: colors.zinc700 }}>Cancelar pedido</Text></Pressable>
                  </>
                )}
                {current.status === 'paid' && (
                  <>
                    <Text style={[st.stateTitle, { color: colors.green700 }]}>Pago! +{n(current.txills)} Txills</Text>
                    <Pressable onPress={() => setCurrent(null)} style={[st.btn, { backgroundColor: colors.zinc100 }]} accessibilityRole="button"><Text style={{ fontWeight: '600', color: colors.zinc900 }}>Fechar</Text></Pressable>
                  </>
                )}
                {(current.status === 'failed' || current.status === 'cancelled' || current.status === 'expired') && (
                  <>
                    <Text style={st.stateTitle}>{STATUS[current.status].label}</Text>
                    <Pressable onPress={() => { setCurrent(null); setErr(''); }} style={[st.btn, { backgroundColor: colors.brand }]} accessibilityRole="button"><Text style={st.btnWhite}>Tentar outra vez</Text></Pressable>
                  </>
                )}
              </View>
            ) : null}
          </Group>
        )}

        <Group title="Pedidos">
          {orders.data && orders.data.length === 0 ? <Line icon="file-text" label="Histórico de pedidos" value="Ainda não tens pedidos" /> : null}
          {orders.data?.map((o) => (
            <View key={o.id} style={st.order}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }}>{n(o.txills)} Txills</Text>
                <Text style={{ fontSize: 14, color: colors.zinc500 }}>{money(o.amountMinor, o.currency)} · {date(o.createdAt)}</Text>
              </View>
              <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: STATUS[o.status].bg }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: STATUS[o.status].fg }}>{STATUS[o.status].label}</Text>
              </View>
            </View>
          ))}
        </Group>
        <Text style={{ marginHorizontal: 24, marginTop: 20, textAlign: 'center', fontSize: 14, color: colors.zinc500 }}>
          Os Txills comprados entram na carteira e usam-se como os outros: para presentear quem segues. Não se trocam por dinheiro.
        </Text>
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  balance: { marginHorizontal: 16, marginTop: 16, borderRadius: 24, padding: 20, boxShadow: '0 6px 18px rgba(214,51,79,0.3)' },
  balBtn: { marginTop: 16, alignSelf: 'flex-start', height: 40, justifyContent: 'center', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 16 },
  pkg: { width: '48%', flexGrow: 1, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, paddingHorizontal: 12, paddingVertical: 12 },
  prov: { height: 40, justifyContent: 'center', borderRadius: 999, borderWidth: 2, borderColor: colors.zinc200, paddingHorizontal: 16 },
  phone: { height: 48, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, paddingHorizontal: 16, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  primary: { height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: colors.brand },
  stateTitle: { textAlign: 'center', fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  btn: { height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  btnWhite: { fontWeight: '700', color: '#fff' },
  order: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
});
