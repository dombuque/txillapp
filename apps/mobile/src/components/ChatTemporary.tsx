import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { clearPrompt, liveItems, nextExpiryIn, TTL_CHOICES, TTL_TITLE, ttlExplain } from '@/lib/chatTemporary';
import { colors } from '@/lib/theme';

/**
 * Mensagens temporárias e "Limpar conversa" nos ecrãs das conversas (a dois e TxillGroups). A lógica está em
 * src/lib/chatTemporary.ts; aqui só o que se vê: a folha das quatro escolhas, o relógio no cabeçalho e o aviso de sistema.
 */

/**
 * A folha "Mensagens temporárias": Desligadas, 24 horas, 7 dias, 90 dias e uma explicação curta. Quem não pode mudar
 * (membro de um TxillGroup) vê o que está escolhido, sem poder tocar.
 */
export function TtlSheet({ ttl, group = false, canChange, onPick, onClose }: {
  ttl: number | null | undefined; group?: boolean; canChange: boolean;
  onPick: (ttl: number | null) => Promise<unknown>; onClose: () => void;
}) {
  const [busy, setBusy] = useState<number | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const current = ttl ?? null;
  async function pick(next: number | null) {
    if (!canChange || busy !== undefined) return;
    if (next === current) return onClose();
    setBusy(next);
    setErr('');
    try {
      await onPick(next);
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Não consegui mudar. Tenta outra vez.');
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <Sheet title={TTL_TITLE} onClose={onClose}>
      <View style={{ paddingHorizontal: 20 }} accessibilityRole="radiogroup">
        <View style={st.hero}>
          <View style={st.heroIcon}><Icon name="clock" size={26} color={colors.zinc800} /></View>
          <Text style={st.explain}>{ttlExplain(group, canChange)}</Text>
        </View>
        {TTL_CHOICES.map((c) => {
          const on = c.ttl === current;
          return (
            <Pressable
              key={c.label}
              onPress={() => void pick(c.ttl)}
              disabled={!canChange}
              style={({ pressed }) => [st.row, pressed && canChange && { backgroundColor: colors.zinc100 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: !canChange, busy: busy === c.ttl }}
              accessibilityLabel={c.label}
            >
              <Text style={[st.rowText, !canChange && !on && { color: colors.zinc500 }]}>{c.label}</Text>
              <View style={[st.radio, on && st.radioOn]}>{on ? <Icon name="check" size={14} color="#fff" strokeWidth={2.6} /> : null}</View>
            </Pressable>
          );
        })}
        {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
      </View>
    </Sheet>
  );
}

/** O relógio discreto no canto da foto do cabeçalho, enquanto as mensagens temporárias estão ligadas. */
export function TtlBadge({ size = 36 }: { size?: number }) {
  const d = Math.max(16, Math.round(size * 0.46));
  return (
    <View pointerEvents="none" style={[st.badge, { width: d, height: d, borderRadius: d / 2 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icon name="clock" size={Math.round(d * 0.66)} color={colors.zinc700} strokeWidth={2.2} />
    </View>
  );
}

/** Aviso de sistema ao centro da conversa ("Dom ligou as mensagens temporárias: 7 dias."), sem bolha nem menu. */
export function SystemNotice({ text }: { text: string }) {
  return (
    <View style={st.notice} accessibilityRole="text">
      <Icon name="clock" size={13} color={colors.zinc500} strokeWidth={2} />
      <Text style={st.noticeText}>{text}</Text>
    </View>
  );
}

/**
 * As mensagens sem as que já expiraram, e o ecrã volta a desenhar-se na hora em que a próxima expira (a mensagem sai
 * da conversa mesmo sem chegar nada do servidor).
 */
export function useLiveItems<T extends { expiresAt?: string | null }>(items: T[]): T[] {
  const [tick, setTick] = useState(0);
  // A hora (absoluta) em que expira a próxima; só muda quando mudam as mensagens ou depois de acordar.
  const target = useMemo(() => {
    const wait = nextExpiryIn(items);
    return wait === null ? null : Date.now() + wait;
  }, [items, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (target === null) return;
    // setTimeout não aguenta esperas muito longas: acorda no máximo de hora a hora e volta a ver.
    const h = setTimeout(() => setTick((n) => n + 1), Math.min(Math.max(0, target - Date.now()) + 250, 3_600_000));
    return () => clearTimeout(h);
  }, [target, tick]);
  return useMemo(() => liveItems(items), [items, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * "Limpar conversa": pergunta antes (a dois: "A outra pessoa continua a vê-las."; nos grupos: "Os outros…") e, se
 * confirmar, corre `run`. No iPhone, um Alert pedido enquanto a folha do menu ainda se fecha não aparece: espera um pouco.
 */
export function confirmClear(group: boolean, run: () => void) {
  const p = clearPrompt(group);
  const ask = () => Alert.alert(p.title, p.message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: p.confirm, style: 'destructive', onPress: run },
  ]);
  if (Platform.OS === 'ios') setTimeout(ask, 350);
  else ask();
}

const st = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingBottom: 12 },
  heroIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  explain: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.zinc600 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, borderRadius: 16, paddingHorizontal: 8 },
  rowText: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  err: { marginTop: 8, fontSize: 14, color: colors.red600, textAlign: 'center' },
  badge: { position: 'absolute', left: -3, bottom: -3, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.white, boxShadow: '0 1px 2px rgba(24,24,27,0.18)' },
  notice: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '86%', marginVertical: 8, borderRadius: 999, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 5, boxShadow: '0 1px 1px rgba(24,24,27,0.04)' },
  noticeText: { flexShrink: 1, fontSize: 12.5, lineHeight: 17, fontWeight: '600', color: colors.zinc600, textAlign: 'center' },
});
