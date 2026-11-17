import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PageLoader } from '@/components/PontoLoader';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ErrorState } from '@/components/ui/ErrorState';
import { Group, Line } from '@/components/Lines';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { extraApi, newKey, type PaymentOrder } from '@/lib/api.extra';
import { usePurchases } from '@/lib/purchases';
import { colors } from '@/lib/theme';
import { vibesWord } from '@/lib/vibes';
import { t } from '@/lib/i18n';

/** Na app nativa (APK beta), sem métodos de pagamento ativos não se mostra nada de "em breve". */
const NATIVE = Platform.OS !== 'web';

const n = (v: number) => v.toLocaleString('pt-PT');
const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2).replace('.', ',')} ${currency === 'MZN' ? 'MT' : currency}`;
const STATUS: Record<PaymentOrder['status'], { label: string; bg: string; fg: string }> = {
  pending: { get label() { return t('À espera'); }, bg: '#fef3c7', fg: '#92400e' },
  paid: { get label() { return t('Pago'); }, bg: '#d1fae5', fg: '#065f46' },
  failed: { get label() { return t('Falhou'); }, bg: colors.dangerSoft, fg: colors.danger },
  cancelled: { get label() { return t('Cancelado'); }, bg: colors.zinc100, fg: colors.zinc600 },
  expired: { get label() { return t('Expirou'); }, bg: colors.zinc100, fg: colors.zinc600 },
};
const date = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/**
 * Pedidos e pagamentos. Nas versões das lojas não se compram Txills por fora da loja (ver lib/storeRules.ts): o ecrã não
 * existe e uma ligação antiga para /orders abre a carteira.
 */
export default function Orders() {
  const rules = usePurchases();
  if (rules.pending) return <StackPage title={t('Pedidos e pagamentos')}><PageLoader /></StackPage>;
  if (!rules.buyTxills) return <Redirect href={'/wallet' as never} />;
  return <OrdersScreen />;
}

/** Pedidos e pagamentos: o saldo, recarregar Txills e o histórico de pedidos. */
function OrdersScreen() {
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
    if (busy || !chosen || !chosenPkg) return;
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
    <StackPage title={t('Pedidos e pagamentos')}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={[colors.brand, '#e8475f', '#ff8a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.balance}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.85)' }}>{t('O teu saldo')}</Text>
          <Text style={{ marginTop: 4, fontSize: 38, fontWeight: '900', lineHeight: 38, color: '#fff' }}>
            {w.data ? n(w.data.balance) : '…'} <Text style={{ fontSize: 20, fontWeight: '700' }}>{vibesWord(w.data?.balance ?? 0)}</Text>
          </Text>
          <Button label={t('Ver movimentos e presentes')} kind="ghost" dark size="sm" onPress={() => router.push('/wallet' as never)} style={st.balBtn} />
        </LinearGradient>

        {(!NATIVE || providers.length > 0) && (
          <Group title={t('Recarregar vibes')}>
            {cfg.isLoading ? <PageLoader style={{ paddingTop: 24 }} /> : null}
            {cfg.data && providers.length === 0 && !NATIVE ? <Line icon="wallet" label={t('Comprar vibes')} value={t('Em breve: M-Pesa, e-Mola e cartão')} /> : null}
            {cfg.data && providers.length > 0 && !current ? (
              <View style={{ padding: 16, gap: 16 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {cfg.data.packages.map((p) => (
                    <Pressable key={p.id} onPress={() => setPkg(p.id)} accessibilityRole="button" accessibilityState={{ selected: pkg === p.id }} style={({ pressed }) => [st.pkg, pkg === p.id && { borderColor: colors.brand, backgroundColor: colors.rose50 }, pressed && { transform: [{ scale: 0.98 }] }]}>
                      <Text style={{ fontSize: 22, fontWeight: '900', lineHeight: 22, color: colors.zinc900 }}>{n(p.txills)}</Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.zinc500 }}>{vibesWord(p.txills)}</Text>
                      <Text style={{ marginTop: 6, fontSize: 15, fontWeight: '600', color: colors.brand }}>{money(p.priceMinor, p.currency)}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {providers.map((p) => (
                    <Chip key={p.id} label={p.label} selected={chosen?.id === p.id} onPress={() => setProvider(p.id)} accessibilityLabel={t('Pagar com {label}', { label: p.label })} />
                  ))}
                </View>
                {chosen?.needsPhone ? (
                  <View>
                    <Text style={{ marginBottom: 6, fontSize: 14, fontWeight: '600', color: colors.zinc900 }}>{t('O teu número {label}', { label: chosen.label })}</Text>
                    <TextInput value={phone} onChangeText={(t) => { setPhone(t); setErr(''); }} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={20} placeholder="84 123 4567" placeholderTextColor={colors.zinc500} style={st.phone} accessibilityLabel={t('O teu número {label}', { label: chosen.label })} />
                  </View>
                ) : null}
                {err ? <Text style={{ textAlign: 'center', fontSize: 14, color: colors.danger }} accessibilityRole="alert">{err}</Text> : null}
                <Button label={chosenPkg ? t('Pagar {money}', { money: money(chosenPkg.priceMinor, chosenPkg.currency) }) : t('Escolhe um pacote')} onPress={() => void pay()} loading={busy} disabled={payDisabled} />
              </View>
            ) : null}
            {current ? (
              <View style={{ padding: 16, gap: 12, alignItems: 'stretch' }}>
                {current.status === 'pending' && (
                  <>
                    <Text style={st.stateTitle}>{t('À espera do pagamento')}</Text>
                    <Text style={{ textAlign: 'center', fontSize: 14, color: colors.zinc600 }}>
                      {current.provider === 'sandbox' ? t('Pagamento de teste: confirma abaixo.') : t('Confirma o pagamento no teu telemóvel{value}.', { value: current.phoneTail ? (' ' + t('(número terminado em {phoneTail})', { phoneTail: current.phoneTail })) : '' })} {t('Isto atualiza sozinho.')}
                    </Text>
                    {current.provider === 'sandbox' ? (
                      <Button label={t('Simular pagamento')} size="md" onPress={() => void sandboxPay()} loading={busy} />
                    ) : null}
                    <Button label={t('Cancelar pedido')} kind="ghost" size="md" onPress={() => void cancel()} />
                  </>
                )}
                {current.status === 'paid' && (
                  <>
                    <Text style={[st.stateTitle, { color: colors.green700 }]}>{t('Pago! +{n} {vibesWord}', { n: n(current.txills), vibesWord: vibesWord(current.txills) })}</Text>
                    <Button label={t('Fechar')} kind="secondary" size="md" onPress={() => setCurrent(null)} />
                  </>
                )}
                {(current.status === 'failed' || current.status === 'cancelled' || current.status === 'expired') && (
                  <>
                    <Text style={st.stateTitle}>{STATUS[current.status].label}</Text>
                    <Button label={t('Tentar outra vez')} size="md" onPress={() => { setCurrent(null); setErr(''); }} />
                  </>
                )}
              </View>
            ) : null}
          </Group>
        )}

        <Group title={t('Pedidos')}>
          {orders.isLoading ? <PageLoader style={{ paddingTop: 24 }} /> : null}
          {orders.isError && !orders.data ? <ErrorState what={t('os pedidos')} onRetry={() => void orders.refetch()} style={{ marginTop: 16, marginBottom: 16 }} /> : null}
          {orders.data && orders.data.length === 0 ? <Line icon="file-text" label={t('Histórico de pedidos')} value={t('Ainda não tens pedidos')} /> : null}
          {orders.data?.map((o) => (
            <View key={o.id} style={st.order}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.zinc900 }}>{n(o.txills)} {vibesWord(o.txills)}</Text>
                <Text style={{ fontSize: 14, color: colors.zinc500 }}>{money(o.amountMinor, o.currency)} · {date(o.createdAt)}</Text>
              </View>
              <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: STATUS[o.status].bg }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: STATUS[o.status].fg }}>{STATUS[o.status].label}</Text>
              </View>
            </View>
          ))}
        </Group>
        <Text style={{ marginHorizontal: 24, marginTop: 20, textAlign: 'center', fontSize: 14, color: colors.zinc500 }}>
          {t('As vibes compradas entram na carteira e usam-se como as outras: para oferecer a quem segues. Não se trocam por dinheiro.')}
        </Text>
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  balance: { marginHorizontal: 16, marginTop: 16, borderRadius: 24, padding: 20, boxShadow: '0 6px 18px rgba(214,51,79,0.3)' },
  balBtn: { marginTop: 16, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)' },
  pkg: { width: '48%', flexGrow: 1, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, paddingHorizontal: 12, paddingVertical: 12 },
  phone: { height: 48, borderRadius: 16, borderWidth: 2, borderColor: colors.zinc200, paddingHorizontal: 16, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  stateTitle: { textAlign: 'center', fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  order: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
});
