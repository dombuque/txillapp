import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { QrSvg, downloadQrSvg, origin } from '@/components/VenueQr';
import { locaisApi, type Venue, type VenuePayment } from '@/lib/api.locais';
import { cardShadow, colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

const fmt = (n: number) => n.toLocaleString('pt-PT');

export const venuePaymentsKey = (slug: string) => ['venue-payments', slug] as const;

/**
 * A secção Txills do Gerir: ligar os pagamentos (dono e administradores), o saldo do local,
 * o QR para receber (com valor fixo opcional) e a lista dos pagamentos recebidos.
 */
export function VenueTxills({ v }: { v: Venue }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const pays = useInfiniteQuery({
    queryKey: venuePaymentsKey(v.slug),
    queryFn: ({ pageParam }) => locaisApi.venuePayments(v.slug, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    retry: false,
  });
  const items = pays.data?.pages.flatMap((p) => p.items) ?? [];
  const balance = pays.data?.pages[0]?.balance ?? v.txillsBalance ?? 0;

  async function toggle(on: boolean) {
    setBusy(true);
    setMsg('');
    try {
      const nv = await locaisApi.updateVenue(v.slug, { acceptsTxills: on });
      qc.setQueryData(['venue', v.slug], nv);
      setMsg(on ? 'Pronto: o local já aceita Txills.' : 'Os pagamentos em Txills ficaram desligados.');
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <View style={st.balance}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.85)' }}>Saldo do local</Text>
        <Text style={{ fontSize: 40, fontWeight: '800', letterSpacing: -1, color: '#fff' }}>{fmt(balance)} <Text style={{ fontSize: 20, fontWeight: '700' }}>Txills</Text></Text>
        <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.9)' }}>Converter Txills em dinheiro ainda não está disponível. Por agora os Txills recebidos ficam no saldo do local.</Text>
      </View>

      <View style={st.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.title}>Aceitar pagamentos em Txills</Text>
            <Text style={st.hint}>{v.acceptsTxills ? 'A página mostra "Aceita Txills" e o botão Pagar com Txills.' : 'Liga para a malta poder pagar aqui com Txills.'}</Text>
          </View>
          {v.canEdit ? (
            <Switch value={v.acceptsTxills} disabled={busy} onValueChange={(on) => void toggle(on)} trackColor={{ true: colors.brand, false: colors.zinc300 }} thumbColor="#fff" {...({ activeThumbColor: '#fff' } as object)} accessibilityLabel="Aceitar pagamentos em Txills" />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: '700', color: v.acceptsTxills ? colors.green700 : colors.zinc500 }}>{v.acceptsTxills ? 'Ligado' : 'Desligado'}</Text>
          )}
        </View>
        {!v.canEdit ? <Text style={[st.hint, { marginTop: 8 }]}>Só o dono e os administradores ligam ou desligam os pagamentos.</Text> : null}
        {msg ? <Text accessibilityRole="alert" style={{ marginTop: 8, fontSize: 14, color: colors.zinc700 }}>{msg}</Text> : null}
      </View>

      {v.acceptsTxills ? <ReceiveQr v={v} /> : null}

      <View style={st.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={st.title}>Pagamentos recebidos</Text>
          <Pressable onPress={() => void pays.refetch()} disabled={pays.isRefetching} hitSlop={8} style={st.iconBtn} accessibilityRole="button" accessibilityLabel="Atualizar">
            {pays.isRefetching && !pays.isFetchingNextPage ? <ActivityIndicator size="small" color={colors.brand} /> : <Icon name="repeat" size={18} color={colors.zinc800} />}
          </Pressable>
        </View>
        {pays.isLoading ? <ActivityIndicator style={{ margin: 20 }} color={colors.brand} /> : null}
        {pays.isError ? (
          <View style={{ paddingVertical: 12 }}>
            <Text style={st.hint}>{(pays.error as Error).message || 'Não consegui carregar os pagamentos.'}</Text>
            <Pressable onPress={() => void pays.refetch()} style={[st.ghost, { marginTop: 8 }]}><Text style={st.ghostText}>Tentar outra vez</Text></Pressable>
          </View>
        ) : null}
        {pays.isSuccess && items.length === 0 ? <Text style={[st.hint, { paddingVertical: 12 }]}>Ainda ninguém pagou com Txills. Põe o QR de receber no balcão.</Text> : null}
        {items.map((p, i) => <PaymentRow key={`${p.at}-${i}`} p={p} first={i === 0} />)}
        {pays.hasNextPage ? (
          <Pressable onPress={() => void pays.fetchNextPage()} disabled={pays.isFetchingNextPage} style={[st.ghost, { marginTop: 8 }]} accessibilityRole="button">
            <Text style={st.ghostText}>{pays.isFetchingNextPage ? 'A carregar…' : 'Ver mais'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Uma linha da lista: quem pagou (pessoa ou cofre de grupo), a nota, quando e quanto. */
function PaymentRow({ p, first }: { p: VenuePayment; first: boolean }) {
  const router = useRouter();
  const group = 'group' in p.from ? p.from.group : null;
  const person = 'group' in p.from ? null : p.from;
  return (
    <Pressable
      onPress={() => router.push((group ? `/messages/g/${group.id}` : `/u/${person!.username}`) as never)}
      style={[st.row, !first && { borderTopWidth: 1, borderTopColor: colors.zinc100 }]}
      accessibilityRole="link"
    >
      {person ? <Avatar name={person.displayName} username={person.username} size={40} /> : <View style={st.groupIcon}><Icon name="users" size={20} color={colors.zinc800} /></View>}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.zinc900 }} numberOfLines={1}>{person ? `Recebido de @${person.username}` : `Do cofre de ${group!.name}`}</Text>
        <Text style={{ fontSize: 13, color: colors.zinc500 }} numberOfLines={1}>{person ? `${person.displayName} · ` : ''}{timeAgo(p.at)}</Text>
        {p.note ? <Text style={{ marginTop: 2, fontSize: 14, color: colors.zinc700 }} numberOfLines={2}>{p.note}</Text> : null}
      </View>
      <Text style={{ marginLeft: 8, fontSize: 18, fontWeight: '800', color: colors.green700 }}>+{fmt(p.amount)}</Text>
    </Pressable>
  );
}

/** O QR para receber: leva a /v/<slug>?pagar=1 e, se quiseres, já com o valor (&valor=200). */
function ReceiveQr({ v }: { v: Venue }) {
  const [valor, setValor] = useState('');
  const n = Number(valor || '0');
  const url = `${origin()}/v/${v.slug}?pagar=1${n >= 1 ? `&valor=${n}` : ''}`;

  async function save() {
    if (Platform.OS === 'web') {
      downloadQrSvg(url, `txillapp-${v.slug}-pagar${n >= 1 ? `-${n}` : ''}.svg`);
      return;
    }
    try {
      await Share.share({ message: `Paga com Txills no Txillapp: ${v.name}${n >= 1 ? ` (${fmt(n)} Txills)` : ''}\n${url}`, url });
    } catch {
      /* cancelado */
    }
  }

  return (
    <View style={st.card} accessibilityLabel="QR para receber Txills">
      <Text style={st.title}>QR para receber</Text>
      <Text style={st.hint}>Quem o ler abre logo o pagamento ao teu local. Deixa o valor em branco para a pessoa escolher, ou fixa um valor (por exemplo, para uma conta).</Text>
      <TextInput
        value={valor}
        onChangeText={(t) => setValor(t.replace(/\D/g, '').replace(/^0+/, '').slice(0, 7))}
        keyboardType="number-pad"
        placeholder="Valor fixo em Txills (opcional)"
        placeholderTextColor={colors.zinc500}
        style={st.input}
        accessibilityLabel="Valor fixo em Txills"
      />
      <View style={{ marginTop: 12, alignSelf: 'center', width: '100%', maxWidth: 240, aspectRatio: 1 }}>
        <QrSvg text={url} size={240} />
      </View>
      <Text style={{ marginTop: 8, textAlign: 'center', fontSize: 15, fontWeight: '700', color: colors.zinc900 }}>{n >= 1 ? `Pagar ${fmt(n)} Txills` : 'Pagar com Txills'}</Text>
      <Text style={{ textAlign: 'center', fontSize: 12, color: colors.zinc500 }} numberOfLines={1} selectable>{url.replace(/^https?:\/\//, '')}</Text>
      <Pressable onPress={() => void save()} style={[st.dark, { marginTop: 12 }]} accessibilityRole="button">
        <Icon name="download" size={18} color="#fff" />
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{Platform.OS === 'web' ? 'Guardar para imprimir' : 'Partilhar para imprimir'}</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  balance: { borderRadius: 24, backgroundColor: colors.brand, padding: 20, boxShadow: '0 10px 24px rgba(214,51,79,0.3)' },
  card: { borderRadius: 24, backgroundColor: colors.white, padding: 16, ...cardShadow },
  title: { fontSize: 16, fontWeight: '800', color: colors.zinc900 },
  hint: { marginTop: 2, fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  input: { marginTop: 12, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.zinc900 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  groupIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  ghost: { height: 44, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '700', color: colors.zinc800 },
  dark: { height: 44, borderRadius: 999, backgroundColor: colors.zinc900, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
