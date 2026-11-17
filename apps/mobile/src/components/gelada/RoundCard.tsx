import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { geladaApi, geladaKeys, type GeladaPerson, type GeladaRound } from '@/lib/api.gelada';
import { drinkLabel, handleOf, suggestLine, geladaErrorText } from '@/lib/gelada';
import { colors } from '@/lib/theme';
import { Avatar } from '../Avatar';
import { CheersPour } from '../CheersPour';
import { DrinkArt } from '../DrinkArt';
import { Icon } from '../Icon';
import { InlineBadge } from '../NameWithBadge';
import { Sheet } from '../Sheet';
import { Button } from '../ui/Button';
import { DrinkSheet } from './DrinkSheet';
import { AMBER_INK } from './GeladaCard';
import { t } from '@/lib/i18n';

const face = (p: GeladaPerson, size = 30) => <Avatar name={p.displayName} username={p.hasAvatar ? p.username : undefined} size={size} />;

/**
 * A rodada no TxillGroup (mensagem kind 'rodada'), como as sondagens: quem paga em cima, quem bebe em baixo (cada um com a
 * sua bebida desenhada), «Eu entro» (escolher a bebida), «Esta pago eu», a sugestão «Hoje paga @x?» (quem há mais tempo não
 * paga) e «Fechar rodada» (com «Pôr no livro», se fui eu a pagar). Fechar faz o brinde. As mudanças chegam a todos pelo
 * tempo real (o servidor manda 'edited' ao grupo). Sem rodada: «Esta rodada já não existe».
 */
export function RoundCard({ r: initial }: { r: GeladaRound | null | undefined }) {
  const qc = useQueryClient();
  const [r, setR] = useState<GeladaRound | null>(initial ?? null);
  const [picking, setPicking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [bill, setBill] = useState(true);
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);
  const prev = useRef(initial?.status);
  useEffect(() => {
    setR(initial ?? null);
    if (initial && prev.current === 'open' && initial.status === 'closed') setBurst((k) => k + 1);
    prev.current = initial?.status;
  }, [initial]);

  if (!r) {
    return (
      <View style={[st.card, st.gone]}>
        <Icon name="cheers" size={18} color={colors.zinc500} />
        <Text style={st.goneText}>{t('Esta rodada já não existe')}</Text>
      </View>
    );
  }
  const round = r;
  const open = round.status === 'open';

  async function run(f: () => Promise<GeladaRound>, after?: (n: GeladaRound) => void) {
    if (busy) return;
    setBusy(true);
    try {
      const n = await f();
      prev.current = n.status;
      setR(n);
      after?.(n);
      void qc.invalidateQueries({ queryKey: ['chat-group', round.groupId] });
      void qc.invalidateQueries({ queryKey: geladaKeys.round(round.id) });
    } catch (e) {
      Alert.alert(t('Não deu'), geladaErrorText(e, t('Não consegui mudar a rodada. Tenta outra vez.')));
    } finally {
      setBusy(false);
    }
  }
  const closeNow = () =>
    run(() => geladaApi.close(round.id, round.canBill && bill), () => {
      setClosing(false);
      setBurst((k) => k + 1);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (round.canBill && bill) void qc.invalidateQueries({ queryKey: geladaKeys.book() });
    });

  const drinkers = round.entries;
  const hint = suggestLine(round.suggestedPayer);
  return (
    <View style={st.card} accessibilityLabel={t('Rodada {value}. {value2} {n} a beber.', { value: open ? t('aberta') : t('fechada'), value2: round.payer ? t('Paga {handleOf}.', { handleOf: handleOf(round.payer) }) : t('Ainda ninguém paga.'), n: drinkers.length })}>
      <LinearGradient colors={['#fff7e6', '#fde68a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.head}>
        <View style={st.badge}><Icon name="cheers" size={20} color={AMBER_INK} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.kicker}>{open ? t('RODADA ABERTA') : t('RODADA FECHADA')}</Text>
          <Text style={st.title} numberOfLines={2}>
            {round.payer ? t('Esta paga {value}', { value: round.payer.username ? `@${round.payer.username}` : t('Conta eliminada') }) : open ? t('Quem paga esta?') : t('Rodada sem quem pagasse')}
            {round.payer?.username ? <InlineBadge who={round.payer} fontSize={16} /> : null}
          </Text>
        </View>
        {round.payer ? face(round.payer, 36) : null}
      </LinearGradient>

      <View style={st.body}>
        {open && !round.payer && hint ? <Text style={st.hint}>{hint}</Text> : null}
        {round.lastPayer ? <Text style={st.meta}>{t('A última foi paga por {handleOf}', { handleOf: handleOf(round.lastPayer) })}</Text> : null}

        <Text style={st.section}>{drinkers.length ? t('A beber · {n}', { n: drinkers.length }) : t('Ainda ninguém entrou')}</Text>
        {drinkers.map((e) => (
          <View key={e.person.username || e.drink.slug} style={st.entry} accessibilityLabel={`${e.mine ? t('Tu') : handleOf(e.person)}: ${drinkLabel(e.drink)}`}>
            {face(e.person)}
            <Text style={st.who} numberOfLines={1}>{e.mine ? t('Tu') : e.person.displayName.split(' ')[0] || handleOf(e.person)}</Text>
            <Text style={st.drinkName} numberOfLines={1}>{drinkLabel(e.drink)}</Text>
            <DrinkArt slug={e.drink.slug} category={e.drink.category} size={30} />
          </View>
        ))}

        {open ? (
          <View style={{ marginTop: 10, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable disabled={busy} onPress={() => setPicking(true)} style={({ pressed }) => [st.btn, st.primary, { flex: 1 }, pressed && st.pressed]} accessibilityRole="button" accessibilityLabel={round.me.joined ? t('Mudar a bebida (tens {drinkLabel})', { drinkLabel: drinkLabel(round.me.drink!) }) : t('Eu entro: escolher a bebida')}>
                <Text style={st.primaryText} numberOfLines={1}>{round.me.joined ? t('Mudar') : t('Eu entro')}</Text>
              </Pressable>
              {round.me.payer ? (
                <Pressable disabled={busy} onPress={() => void run(() => geladaApi.pay(round.id, false))} style={({ pressed }) => [st.btn, st.ghost, { flex: 1 }, pressed && st.pressed]} accessibilityRole="button">
                  <Text style={st.ghostText} numberOfLines={1}>{t('Já não pago')}</Text>
                </Pressable>
              ) : !round.payer ? (
                <Pressable disabled={busy} onPress={() => void run(() => geladaApi.pay(round.id, true))} style={({ pressed }) => [st.btn, st.pay, { flex: 1 }, pressed && st.pressed]} accessibilityRole="button">
                  <Text style={st.payText} numberOfLines={1}>{t('Esta pago eu')}</Text>
                </Pressable>
              ) : null}
            </View>
            {round.me.joined ? (
              <Pressable disabled={busy} onPress={() => void run(() => geladaApi.leave(round.id))} style={({ pressed }) => [st.small, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                <Text style={st.smallText}>{t('Sair da rodada')}</Text>
              </Pressable>
            ) : null}
            {round.canClose ? (
              <Pressable disabled={busy} onPress={() => setClosing(true)} style={({ pressed }) => [st.btn, st.ghost, pressed && st.pressed]} accessibilityRole="button">
                <Icon name="check" size={18} color={colors.zinc800} />
                <Text style={st.ghostText}>{t('Fechar rodada')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Text style={[st.meta, { marginTop: 8 }]}>{t('Saúde!')}</Text>
        )}
      </View>
      <CheersPour n={burst} size={180} />

      {picking && (
        <DrinkSheet
          title={t('Eu entro com…')}
          selected={null}
          onClose={() => setPicking(false)}
          onPick={(d) => {
            setPicking(false);
            void run(() => geladaApi.join(round.id, d.id));
          }}
        />
      )}
      {closing && (
        <Sheet title={t('Fechar a rodada?')} onClose={() => setClosing(false)}>
          <View style={{ paddingHorizontal: 20, paddingBottom: 16, gap: 12 }}>
            <Text style={{ fontSize: 15, lineHeight: 21, color: colors.zinc700 }}>
              {round.payer ? t('Fica no histórico que {value}: a próxima é de outro.', { value: round.me.payer ? t('pagaste tu') : t('pagou {handleOf}', { handleOf: handleOf(round.payer) }) }) : t('Ninguém disse «Esta pago eu»: a rodada fecha sem ficar no histórico.')}
            </Text>
            {round.canBill ? (
              <View style={st.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.zinc900 }}>{t('Pôr no livro das geladas')}</Text>
                  <Text style={{ fontSize: 13, lineHeight: 18, color: colors.zinc600 }}>{t('Quem bebeu fica a dever-te a sua bebida.')}</Text>
                </View>
                <Switch value={bill} onValueChange={setBill} trackColor={{ true: colors.brand, false: colors.zinc300 }} thumbColor="#fff" accessibilityLabel={t('Pôr no livro das geladas')} />
              </View>
            ) : null}
            <Button label={t('Fechar e brindar')} block loading={busy} onPress={() => void closeNow()} />
          </View>
        </Sheet>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { width: 280, maxWidth: '100%', overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: '#f1e3c4', backgroundColor: '#fff', boxShadow: '0 2px 10px rgba(146,64,14,0.10)' },
  gone: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderColor: colors.zinc200, backgroundColor: colors.zinc100, boxShadow: 'none' },
  goneText: { flex: 1, fontSize: 14, color: colors.zinc600, fontStyle: 'italic' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.75)', alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: AMBER_INK },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '800', color: colors.zinc900 },
  body: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 14 },
  hint: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: colors.rose50, paddingHorizontal: 10, paddingVertical: 4, fontSize: 13, fontWeight: '700', color: colors.brand, overflow: 'hidden' },
  meta: { marginTop: 6, fontSize: 13, color: colors.zinc600 },
  section: { marginTop: 10, marginBottom: 2, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.zinc500 },
  entry: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  who: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: colors.zinc900 },
  drinkName: { flex: 1, minWidth: 0, textAlign: 'right', fontSize: 13, color: colors.zinc600 },
  btn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  primary: { backgroundColor: colors.brand },
  primaryText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  pay: { backgroundColor: '#fef3c7', borderWidth: 1, borderColor: colors.amber300 },
  payText: { fontSize: 15, fontWeight: '700', color: AMBER_INK },
  ghost: { borderWidth: 1, borderColor: colors.zinc300, backgroundColor: '#fff' },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.zinc800 },
  small: { alignSelf: 'center', minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  smallText: { fontSize: 13, fontWeight: '600', color: colors.zinc600, textDecorationLine: 'underline' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.zinc200, padding: 12 },
});
