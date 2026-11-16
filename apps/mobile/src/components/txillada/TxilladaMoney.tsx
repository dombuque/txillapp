import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { txilladaApi } from '@/lib/api.txillada';
import { colors } from '@/lib/theme';
import { GIFT_MAX, GIFT_PRESETS, fmtTxills, giftError, goalProgress, parseAmount, txillsLabel, type TxilladaDto, type TxilladaGiver } from '@/lib/txillada';
import { GlassButton, LiveBadge } from './TxilladaParts';

/**
 * O dinheiro da Txillada (0167, docs/txillada-contrato.md): o cartão de uma Txillada privada antes de pagar (`LockedView`),
 * a barra da Angariação (`GoalBar`), quem mais ofereceu (`TopGivers`) e a folha para oferecer Txills (`GiftSheet`). Os
 * Txills ficam na app (não se levantam) e aqui não há compras: sem saldo, a app aponta para a carteira.
 */

/**
 * Uma Txillada privada a decorrer sem a entrada: só o anfitrião (com o selo), o título, «AO VIVO» e o preço. «Entrar por N
 * Txills» pede confirmação (com o saldo) antes de pagar; paga-se uma vez e volta-se a entrar sem pagar.
 */
export function LockedView({ dto, onPay, onWallet, onBack, top, bottom }: {
  dto: TxilladaDto; onPay: () => Promise<{ error: string; insufficient: boolean } | null>; onWallet: () => void; onBack: () => void; top: number; bottom: number;
}) {
  const price = dto.price ?? 0;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error: string; insufficient: boolean } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!confirm) return;
    let dead = false;
    void txilladaApi.balance().then((b) => { if (!dead) setBalance(b); });
    return () => { dead = true; };
  }, [confirm]);
  const short = balance != null && balance < price;

  async function pay() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const e = await onPay();
    setBusy(false);
    if (e) setErr(e);
  }

  return (
    <View style={[lk.screen, { paddingTop: top + 12, paddingBottom: bottom + 16 }]}>
      <View style={lk.bar}>
        <View style={{ flex: 1 }} />
        <GlassButton icon="x" label="Sair" onPress={onBack} />
      </View>
      <View style={lk.body}>
        <View style={lk.ring}>
          <Avatar name={dto.host.displayName} username={dto.host.avatarUrl ? dto.host.username : undefined} size={88} />
        </View>
        <LiveBadge />
        <NameWithBadge name={`@${dto.host.username}`} who={dto.host} style={lk.name} center />
        {dto.title ? <Text style={lk.title} numberOfLines={2}>{dto.title}</Text> : null}
        <View style={lk.lockPill}>
          <Icon name="lock" size={15} color="#fff" strokeWidth={2.3} />
          <Text style={lk.lockText}>Txillada privada</Text>
        </View>
        <Text style={lk.price}>{txillsLabel(price)}</Text>
        <Text style={lk.sub}>Pagas uma vez e entras. Se saíres, voltas a entrar sem pagar outra vez.</Text>

        {err ? (
          <View style={lk.err} accessibilityRole="alert">
            <Text style={lk.errText}>{err.insufficient ? `${err.error} Os Txills estão na tua carteira.` : err.error}</Text>
            {err.insufficient ? (
              <Pressable onPress={onWallet} style={({ pressed }) => [lk.walletBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                <Icon name="wallet" size={16} color={colors.zinc900} strokeWidth={2.2} />
                <Text style={lk.walletText}>Ver a carteira</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!confirm ? (
          <Pressable onPress={() => setConfirm(true)} style={({ pressed }) => [lk.cta, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
            <Icon name="lock" size={18} color="#fff" strokeWidth={2.3} />
            <Text style={lk.ctaText}>Entrar por {txillsLabel(price)}</Text>
          </Pressable>
        ) : (
          <View style={lk.confirm}>
            <Text style={lk.confirmTitle}>Pagar {txillsLabel(price)} a @{dto.host.username}?</Text>
            <Text style={lk.confirmSub}>{balance == null ? 'A ver o teu saldo...' : short ? `Tens ${txillsLabel(balance)}: não chega para esta entrada.` : `Tens ${txillsLabel(balance)}. Ficas com ${txillsLabel(balance - price)}.`}</Text>
            <View style={lk.confirmRow}>
              <Pressable onPress={() => { setConfirm(false); setErr(null); }} style={({ pressed }) => [lk.cancel, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                <Text style={lk.cancelText}>Cancelar</Text>
              </Pressable>
              {short ? (
                <Pressable onPress={onWallet} style={({ pressed }) => [lk.pay, pressed && { opacity: 0.9 }]} accessibilityRole="button">
                  <Text style={lk.payText}>Ver a carteira</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => void pay()} disabled={busy} style={({ pressed }) => [lk.pay, busy && { opacity: 0.7 }, pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel={`Confirmar: pagar ${txillsLabel(price)}`}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={lk.payText}>Pagar e entrar</Text>}
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * A Angariação por cima do vídeo: o motivo, a barra e «X de Y Txills» (a todos na sala, em tempo real). `compact`: sem o motivo.
 */
export function GoalBar({ raised, goal, purpose }: { raised: number; goal: number | null; purpose?: string }) {
  const p = goalProgress(raised, goal);
  if (!p) return null;
  return (
    <View style={gb.wrap} accessibilityRole="progressbar" accessibilityLabel={`Angariação${purpose ? `: ${purpose}` : ''}. ${p.label}`} accessibilityValue={{ min: 0, max: 100, now: Math.round(p.pct * 100) }}>
      <View style={gb.line}>
        <Icon name="present" size={13} color={colors.brandWarm} strokeWidth={2.3} />
        <Text style={gb.purpose} numberOfLines={1}>{purpose || 'Angariação'}</Text>
        <Text style={gb.label}>{p.label}</Text>
      </View>
      <View style={gb.track}>
        <View style={[gb.fill, { width: `${Math.max(p.pct > 0 ? 3 : 0, p.pct * 100)}%` }, p.done && gb.fillDone]} />
      </View>
    </View>
  );
}

/** Quem mais ofereceu (até 3): a foto, o @ com o selo e quanto. */
export function TopGivers({ items }: { items: readonly TxilladaGiver[] }) {
  if (!items.length) return null;
  return (
    <View style={tg.row} accessibilityLabel={`Quem mais ofereceu: ${items.map((g) => `${g.username}, ${txillsLabel(g.total)}`).join('; ')}`}>
      {items.slice(0, 3).map((g, i) => (
        <View key={g.username} style={[tg.chip, i === 0 && tg.first]}>
          <Avatar name={g.displayName} username={g.avatarUrl ? g.username : undefined} size={18} />
          <NameWithBadge name={g.username} who={g} style={tg.name} containerStyle={{ flexShrink: 1, minWidth: 0 }} />
          <Text style={tg.total}>{fmtTxills(g.total)}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A folha «Oferecer Txills» (num Panel claro): 5, 10, 50, 100 ou outro valor, o saldo e «Oferecer». Sem saldo: a mensagem e
 * «Ver a carteira». `onSend` devolve o saldo novo, ou o erro.
 */
export function GiftSheet({ host, goal, onSend, onWallet, onDone }: {
  host: string; goal: number | null;
  onSend: (amount: number) => Promise<{ balance: number | null; error?: string; insufficient?: boolean }>;
  onWallet: () => void; onDone: (amount: number) => void;
}) {
  const [pick, setPick] = useState<number | null>(GIFT_PRESETS[1]);
  const [custom, setCustom] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; insufficient: boolean } | null>(null);
  useEffect(() => {
    let dead = false;
    void txilladaApi.balance().then((b) => { if (!dead) setBalance(b); });
    return () => { dead = true; };
  }, []);
  const amount = custom ? parseAmount(custom) : pick;
  const bad = giftError(amount, balance);

  async function send() {
    if (busy || amount == null) return;
    if (bad) { setErr({ text: bad, insufficient: balance != null && amount > balance }); return; }
    setBusy(true);
    setErr(null);
    const r = await onSend(amount);
    setBusy(false);
    if (r.error) { setErr({ text: r.error, insufficient: !!r.insufficient }); return; }
    if (r.balance != null) setBalance(r.balance);
    onDone(amount);
  }

  return (
    <View style={gs.wrap}>
      <Text style={gs.lead}>{goal != null ? `Ajuda @${host} a chegar à meta.` : `Oferece Txills a @${host}.`} Os Txills saem da tua carteira.</Text>
      <View style={gs.presets} accessibilityRole="radiogroup" accessibilityLabel="Quantos Txills">
        {GIFT_PRESETS.map((v) => {
          const on = !custom && pick === v;
          return (
            <Pressable key={v} onPress={() => { setPick(v); setCustom(''); setErr(null); }} style={({ pressed }) => [gs.preset, on && gs.presetOn, pressed && { transform: [{ scale: 0.96 }] }]} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={txillsLabel(v)}>
              <Text style={[gs.presetNum, on && { color: '#fff' }]}>{v}</Text>
              <Text style={[gs.presetUnit, on && { color: 'rgba(255,255,255,0.85)' }]}>Txills</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[gs.custom, !!custom && gs.customOn]}>
        <TextInput
          value={custom}
          onChangeText={(t) => { setCustom(t.replace(/[^\d]/g, '').slice(0, 4)); setErr(null); }}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder="Outro valor"
          placeholderTextColor={colors.zinc500}
          style={gs.customInput}
          maxLength={4}
          accessibilityLabel={`Outro valor em Txills, até ${GIFT_MAX}`}
        />
        <Text style={gs.customUnit}>Txills</Text>
      </View>
      <Text style={gs.balance}>{balance == null ? ' ' : `Tens ${txillsLabel(balance)} na carteira.`}</Text>
      {err ? (
        <View style={gs.err} accessibilityRole="alert">
          <Text style={gs.errText}>{err.text}</Text>
          {err.insufficient ? (
            <Pressable onPress={onWallet} style={({ pressed }) => [gs.walletBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              <Icon name="wallet" size={15} color={colors.brand} strokeWidth={2.2} />
              <Text style={gs.walletText}>Ver a carteira</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Pressable onPress={() => void send()} disabled={busy || amount == null} style={({ pressed }) => [gs.send, (busy || amount == null) && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#fff" /> : (
          <>
            <Icon name="present" size={19} color="#fff" strokeWidth={2.2} />
            <Text style={gs.sendText}>{amount != null ? `Oferecer ${txillsLabel(amount)}` : 'Oferecer'}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const glass = Platform.OS === 'web' ? ({ backdropFilter: 'blur(12px) saturate(160%)', WebkitBackdropFilter: 'blur(12px) saturate(160%)' } as object) : {};

const lk = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 },
  bar: { flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, maxWidth: 420, width: '100%', alignSelf: 'center' },
  ring: { borderRadius: 999, padding: 3, borderWidth: 3, borderColor: colors.brand, marginBottom: 4 },
  name: { color: '#fff', fontSize: 18, fontWeight: '800' },
  title: { color: 'rgba(255,255,255,0.86)', fontSize: 15, lineHeight: 21, textAlign: 'center', fontWeight: '500' },
  lockPill: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  lockText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  price: { color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  sub: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
  cta: { marginTop: 14, height: 52, alignSelf: 'stretch', borderRadius: 26, backgroundColor: colors.brand, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  confirm: { marginTop: 14, alignSelf: 'stretch', padding: 16, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', gap: 6 },
  confirmTitle: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  confirmSub: { color: 'rgba(255,255,255,0.72)', fontSize: 14, textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  cancel: { flex: 1, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  pay: { flex: 1.4, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  payText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  err: { alignSelf: 'stretch', marginTop: 6, padding: 12, borderRadius: 14, backgroundColor: 'rgba(220,38,38,0.22)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.45)', gap: 8, alignItems: 'center' },
  errText: { color: '#fff', fontSize: 14, lineHeight: 19, textAlign: 'center', fontWeight: '600' },
  walletBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: '#fff' },
  walletText: { color: colors.zinc900, fontSize: 14, fontWeight: '800' },
});

const gb = StyleSheet.create({
  wrap: { gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: 'rgba(14,14,18,0.5)', ...glass },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  purpose: { flex: 1, minWidth: 0, color: '#fff', fontSize: 12.5, fontWeight: '700' },
  label: { color: 'rgba(255,255,255,0.88)', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brandWarm },
  fillDone: { backgroundColor: '#34d399' },
});

const tg = StyleSheet.create({
  row: { flexDirection: 'row', gap: 5, flexWrap: 'nowrap' },
  chip: { flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingLeft: 4, paddingRight: 8, borderRadius: 13, backgroundColor: 'rgba(14,14,18,0.5)', ...glass },
  first: { borderWidth: 1, borderColor: 'rgba(255,154,91,0.7)' },
  name: { color: '#fff', fontSize: 12, fontWeight: '700' },
  total: { color: colors.brandWarm, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
});

const gs = StyleSheet.create({
  wrap: { gap: 10, paddingHorizontal: 4, paddingBottom: 6 },
  lead: { fontSize: 14.5, lineHeight: 20, color: colors.zinc600, textAlign: 'center' },
  presets: { flexDirection: 'row', gap: 8 },
  preset: { flex: 1, minWidth: 0, height: 62, borderRadius: 16, borderWidth: 1.5, borderColor: colors.zinc200, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  presetOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  presetNum: { fontSize: 20, fontWeight: '900', color: colors.zinc900, fontVariant: ['tabular-nums'] },
  presetUnit: { fontSize: 11.5, fontWeight: '700', color: colors.zinc500 },
  custom: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: colors.zinc200, paddingRight: 16 },
  customOn: { borderColor: colors.brand },
  customInput: { flex: 1, minWidth: 0, height: 46, paddingHorizontal: 18, fontSize: 16, fontWeight: '700', color: colors.zinc900, outlineStyle: 'none' as never },
  customUnit: { fontSize: 14, fontWeight: '700', color: colors.zinc500 },
  balance: { fontSize: 13.5, color: colors.zinc500, textAlign: 'center' },
  err: { padding: 12, borderRadius: 14, backgroundColor: '#fef2f2', gap: 8, alignItems: 'center' },
  errText: { color: colors.red600, fontSize: 14, lineHeight: 19, textAlign: 'center', fontWeight: '600' },
  walletBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1.5, borderColor: colors.brand },
  walletText: { color: colors.brand, fontSize: 14, fontWeight: '800' },
  send: { height: 52, borderRadius: 26, backgroundColor: colors.brand, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 16.5, fontWeight: '800' },
});
