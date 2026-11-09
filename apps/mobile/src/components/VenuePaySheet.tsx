import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { VenueLogo } from '@/components/VenueCard';
import { ApiError, api, type WalletView } from '@/lib/api';
import { newKey } from '@/lib/api.extra';
import { aoLocal, locaisApi, shortTx, type Venue } from '@/lib/api.locais';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

const QUICK = [50, 100, 200, 500];
const MAX_DIGITS = 7;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const fmt = (n: number) => n.toLocaleString('pt-PT');
const two = (n: number) => String(n).padStart(2, '0');
/** Data e hora sem depender do Intl do aparelho (o Hermes nem sempre o tem completo). */
const quando = (d: Date) => `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;

type Step = 'amount' | 'confirm' | 'done';
interface Receipt { transactionId: string; balance: number; amount: number; note: string; at: Date }

/**
 * Pagar a um local com Txills, em três passos: o valor (teclado grande ou valores rápidos) e uma nota,
 * a confirmação, e o recibo para mostrar a quem atende. Cada confirmação leva a sua chave de idempotência,
 * por isso dois toques seguidos nunca pagam duas vezes.
 */
export function VenuePaySheet({ venue, preset, onClose }: { venue: Venue; preset?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  const balance = wallet.data?.balance;
  const [digits, setDigits] = useState(preset && preset > 0 ? String(Math.floor(preset)).slice(0, MAX_DIGITS) : '');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<Step>('amount');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const key = useRef<string>(newKey());
  const inflight = useRef(false);
  const noteFocused = useRef(false);

  const amount = Number(digits || '0');
  const short = balance != null && amount > balance;
  const ao = aoLocal(venue.kind);

  const press = (k: string) => {
    setErr('');
    setDigits((d) => {
      if (k === 'del') return d.slice(0, -1);
      if (k === 'clear') return '';
      const nd = (d === '0' ? '' : d) + k;
      return nd.length > MAX_DIGITS ? d : nd.replace(/^0+/, '');
    });
  };

  // No computador também se escreve o valor com o teclado (números, apagar, Enter para continuar).
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (stepRef.current !== 'amount' || noteFocused.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Escape') press('clear');
      else if (e.key === 'Enter') toConfirmRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function toConfirm() {
    if (amount < 1) return setErr('Escolhe quantos Txills queres pagar');
    if (short) return setErr(`O teu saldo não chega. Tens ${fmt(balance!)} Txills.`);
    setErr('');
    // Chave nova para esta confirmação: repetir o mesmo pedido nunca paga duas vezes.
    key.current = newKey();
    setStep('confirm');
  }
  const toConfirmRef = useRef(toConfirm);
  toConfirmRef.current = toConfirm;

  async function pay() {
    if (inflight.current) return; // duplo toque: o segundo não faz nada
    inflight.current = true;
    setBusy(true);
    setErr('');
    const text = note.trim();
    try {
      const r = await locaisApi.payVenue(venue.slug, { amount, note: text || undefined, idempotencyKey: key.current });
      setReceipt({ transactionId: r.transactionId, balance: r.balance, amount, note: text, at: new Date() });
      setStep('done');
      qc.setQueryData<WalletView>(['wallet'], (w) => (w ? { ...w, balance: r.balance } : w));
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    } catch (e) {
      // O servidor respondeu com um erro (nada foi pago): a próxima tentativa leva chave nova.
      // Sem resposta (rede): mantém-se a chave, para que repetir não pague duas vezes.
      if (e instanceof ApiError) key.current = newKey();
      setErr((e as Error).message || 'Não consegui pagar. Tenta outra vez.');
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  if (step === 'done' && receipt) return <ReceiptView venue={venue} r={receipt} onClose={onClose} />;

  if (step === 'confirm') {
    return (
      <Sheet title="Confirmar pagamento" onClose={onClose}>
        <View style={{ paddingHorizontal: 24 }}>
          <View style={st.confirmBox}>
            <VenueLogo venue={venue} size={56} />
            <Text style={st.confirmQ} accessibilityRole="header">Pagar {fmt(amount)} Txills {ao} {venue.name}?</Text>
            {receiptNote(note.trim())}
            {balance != null ? <Text style={st.after}>Ficas com {fmt(Math.max(0, balance - amount))} Txills.</Text> : null}
          </View>
          <Text style={st.err} accessibilityRole="alert">{err}</Text>
          <Pressable onPress={() => void pay()} disabled={busy} style={[st.primary, busy && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`Confirmar o pagamento de ${amount} Txills`}>
            <Icon name="check-circle" size={20} color="#fff" />
            <Text style={st.primaryText}>{busy ? 'A pagar…' : `Pagar ${fmt(amount)} Txills`}</Text>
          </Pressable>
          <Pressable onPress={() => { setErr(''); setStep('amount'); }} disabled={busy} style={st.ghost} accessibilityRole="button">
            <Text style={st.ghostText}>Voltar e mudar</Text>
          </Pressable>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet title={`Pagar ${ao} ${venue.name}`} onClose={onClose}>
      <ScrollView style={{ paddingHorizontal: 24 }} keyboardShouldPersistTaps="handled">
        <View style={st.balanceRow}>
          <Icon name="wallet" size={16} color={colors.zinc600} />
          <Text style={st.balanceText}>{balance != null ? <>Tens <Text style={{ fontWeight: '800', color: colors.zinc900 }}>{fmt(balance)} Txills</Text></> : wallet.isError ? 'Não consegui ver o teu saldo' : 'A ver o teu saldo…'}</Text>
        </View>

        <View style={st.display} accessibilityLiveRegion="polite" accessibilityLabel={`${amount} Txills`}>
          <Text style={[st.big, !digits && { color: colors.zinc300 }, short && { color: colors.red600 }]} numberOfLines={1} adjustsFontSizeToFit>{fmt(amount)}</Text>
          <Text style={st.unit}>Txills</Text>
        </View>
        {preset ? <Text style={st.presetHint}>Valor pedido pelo local. Podes mudar se for preciso.</Text> : null}

        <View style={st.quick} accessibilityRole="radiogroup">
          {QUICK.map((q) => {
            const on = amount === q;
            return (
              <Pressable key={q} onPress={() => { setErr(''); setDigits(String(q)); }} style={[st.chip, on && { backgroundColor: colors.zinc900 }]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Text style={[st.chipText, on && { color: '#fff' }]}>{q}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={st.pad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'].map((k) => (
            <Pressable key={k} onPress={() => press(k)} style={({ pressed }) => [st.key, pressed && { backgroundColor: colors.zinc200 }]} accessibilityRole="button" accessibilityLabel={k === 'del' ? 'Apagar' : k === 'clear' ? 'Limpar' : k}>
              {k === 'del' ? <Backspace /> : k === 'clear' ? <Text style={[st.keyText, { fontSize: 16 }]}>Limpar</Text> : <Text style={st.keyText}>{k}</Text>}
            </Pressable>
          ))}
        </View>

        <TextInput
          value={note}
          onChangeText={setNote}
          onFocus={() => { noteFocused.current = true; }}
          onBlur={() => { noteFocused.current = false; }}
          maxLength={120}
          placeholder="Nota (opcional), ex.: Duas geladas"
          placeholderTextColor={colors.zinc500}
          style={st.field}
          accessibilityLabel="Nota do pagamento"
        />
        <Text style={st.err} accessibilityRole="alert">{err || (short ? `O teu saldo não chega. Tens ${fmt(balance!)} Txills.` : '')}</Text>
        <Pressable onPress={toConfirm} disabled={amount < 1 || short} style={[st.primary, (amount < 1 || short) && { opacity: 0.5 }]} accessibilityRole="button">
          <Text style={st.primaryText}>{amount < 1 ? 'Escolhe o valor' : `Continuar com ${fmt(amount)} Txills`}</Text>
        </Pressable>
        <View style={{ height: 8 }} />
      </ScrollView>
    </Sheet>
  );
}

const receiptNote = (n: string) => (n ? <Text style={st.note} numberOfLines={3}>“{n}”</Text> : null);

/** O recibo, feito para mostrar a quem atende: valor grande, o local, a hora, o número do recibo e um relógio a andar (prova que não é uma foto). */
function ReceiptView({ venue, r, onClose }: { venue: Venue; r: Receipt; onClose: () => void }) {
  const { user } = useAuth();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Sheet onClose={onClose}>
      <ScrollView style={{ paddingHorizontal: 24 }}>
        <View style={st.receipt} accessibilityLabel={`Pagamento feito: ${r.amount} Txills ${aoLocal(venue.kind)} ${venue.name}, recibo ${shortTx(r.transactionId)}`}>
          <View style={st.okBadge}><Icon name="check" size={34} strokeWidth={2.6} color="#fff" /></View>
          <Text style={st.okTitle}>Pagamento feito</Text>
          <Text style={st.receiptAmount} numberOfLines={1} adjustsFontSizeToFit>{fmt(r.amount)}</Text>
          <Text style={st.receiptUnit}>Txills</Text>
          <View style={st.receiptVenue}>
            <VenueLogo venue={venue} size={32} />
            <Text style={st.receiptVenueName} numberOfLines={2}>{venue.name}</Text>
          </View>
          {receiptNote(r.note)}
          <View style={st.lines}>
            <Line label="Quando" value={quando(r.at)} />
            <Line label="Recibo" value={shortTx(r.transactionId)} mono />
            {user ? <Line label="Pago por" value={`@${user.username}`} /> : null}
            <Line label="O teu saldo" value={`${fmt(r.balance)} Txills`} />
          </View>
          <View style={st.live}>
            <View style={st.liveDot} />
            <Text style={st.liveText}>Agora são {two(now.getHours())}:{two(now.getMinutes())}:{two(now.getSeconds())}</Text>
          </View>
        </View>
        <Text style={st.showHint}>Mostra este ecrã a quem te atende.</Text>
        <Pressable onPress={onClose} style={st.primary} accessibilityRole="button"><Text style={st.primaryText}>Feito</Text></Pressable>
        <View style={{ height: 8 }} />
      </ScrollView>
    </Sheet>
  );
}

function Line({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={st.line}>
      <Text style={st.lineLabel}>{label}</Text>
      <Text style={[st.lineValue, mono && { letterSpacing: 2, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) }]} selectable>{value}</Text>
    </View>
  );
}

/** Tecla de apagar (desenhada aqui, a biblioteca Tx não tem uma). */
function Backspace() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={colors.zinc900} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M8.5 5.5h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-10L3.5 12Z" />
      <Path d="M11.5 9.5l5 5" />
      <Path d="M16.5 9.5l-5 5" />
    </Svg>
  );
}

const st = StyleSheet.create({
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 14, paddingVertical: 6 },
  balanceText: { fontSize: 14, color: colors.zinc700 },
  display: { marginTop: 12, alignItems: 'center' },
  big: { fontSize: 64, lineHeight: 72, fontWeight: '800', letterSpacing: -2, color: colors.zinc900 },
  unit: { marginTop: -4, fontSize: 16, fontWeight: '700', color: colors.zinc500 },
  presetHint: { marginTop: 6, textAlign: 'center', fontSize: 13, color: colors.zinc500 },
  quick: { marginTop: 16, flexDirection: 'row', gap: 8 },
  chip: { flex: 1, height: 42, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  pad: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  key: { width: '32%', height: 56, borderRadius: 16, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 24, fontWeight: '600', color: colors.zinc900 },
  field: { marginTop: 12, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.zinc900 },
  err: { minHeight: 20, marginVertical: 8, textAlign: 'center', fontSize: 14, fontWeight: '600', color: colors.red600 },
  primary: { height: 56, borderRadius: 999, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  ghost: { marginTop: 10, height: 48, borderRadius: 999, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 16, fontWeight: '600', color: colors.zinc800 },
  confirmBox: { alignItems: 'center', gap: 10, borderRadius: 24, backgroundColor: colors.rose50, padding: 20 },
  confirmQ: { textAlign: 'center', fontSize: 24, lineHeight: 30, fontWeight: '800', color: colors.zinc900 },
  note: { textAlign: 'center', fontSize: 15, fontStyle: 'italic', color: colors.zinc700 },
  after: { fontSize: 14, color: colors.zinc600 },
  receipt: { alignItems: 'center', borderRadius: 28, borderWidth: 2, borderColor: colors.green600, backgroundColor: '#f0fdf4', paddingVertical: 24, paddingHorizontal: 20 },
  okBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.green600, alignItems: 'center', justifyContent: 'center' },
  okTitle: { marginTop: 10, fontSize: 18, fontWeight: '800', color: colors.green700 },
  receiptAmount: { marginTop: 4, fontSize: 72, lineHeight: 80, fontWeight: '800', letterSpacing: -2, color: colors.zinc900 },
  receiptUnit: { marginTop: -6, fontSize: 18, fontWeight: '700', color: colors.zinc600 },
  receiptVenue: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%' },
  receiptVenueName: { flexShrink: 1, fontSize: 18, fontWeight: '700', color: colors.zinc900 },
  lines: { marginTop: 16, alignSelf: 'stretch', borderTopWidth: 1, borderTopColor: 'rgba(21,128,61,0.25)', paddingTop: 10, gap: 6 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineLabel: { fontSize: 14, color: colors.zinc600 },
  lineValue: { flexShrink: 1, textAlign: 'right', fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  live: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green600 },
  liveText: { fontSize: 13, fontWeight: '600', color: colors.green700 },
  showHint: { marginVertical: 12, textAlign: 'center', fontSize: 14, color: colors.zinc600 },
});
