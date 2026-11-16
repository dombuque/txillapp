import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Icon } from '@/components/Icon';
import { useKeyboardHeight } from '@/components/StoryParts';
import { useVisibleViewport } from '@/components/zas/useVisibleViewport';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EMPTY_PREP, PREP_KEY, decodePrep, encodeKeep, keepRead, keepWrite, keyFor, prepIsEmpty, type PrepForm } from '@/lib/createKeep';
import { prepPanel, scrollToShow, stableScreen, visibleArea, type Size } from '@/lib/prepKeyboard';
import { sheetViewport } from '@/lib/sheetViewport';
import { txilladaApi, txilladaKey } from '@/lib/api.txillada';
import { useDesktop } from '@/lib/desktop';
import { storyFrame } from '@/lib/storyFrame';
import { colors } from '@/lib/theme';
import {
  KINDS, PRICE_MAX, PRICE_MIN, PURPOSE_MAX, TITLE_MAX, cleanTitle, errorText, goalError, kindHint, parseAmount, prepAudience, priceError, titleError,
  type TxilladaKind,
} from '@/lib/txillada';
import { handOff, usePreview } from '@/lib/txilladaRoom';
import { GlassButton, LiveBadge } from './TxilladaParts';
import { TxilladaVideo } from './TxilladaVideo';

/**
 * Preparar uma Txillada (Criar → TXILLADA): a câmara à vista no cartão 9:16, o título (até 80 letras), o tipo (0167:
 * Pública, Para amigos com «Só amigos próximos», ou Privada com o preço da entrada em Txills), a Angariação (opcional: a meta
 * e para quê) e «Começar Txillada». O tipo fica fixo depois de começar. Ao começar, a câmara passa para o ecrã do live
 * (app/txillada/[id]) sem fechar. Por baixo do cartão, os modos de Criar, como nas câmaras.
 *
 * Com o teclado aberto (lib/prepKeyboard) o cartão fica do mesmo tamanho (medido sem o teclado) e só o painel de baixo sobe
 * para cima do teclado, a rolar por dentro, com o campo onde se escreve à vista. O que se escreveu fica guardado um bocado
 * (lib/createKeep): se a app recarregar ao voltar à vista, o preparar volta como estava.
 */
export function TxilladaPrep({ active, onClose, kinds, kind, onKind }: { active: boolean; onClose: () => void; kinds?: { id: string; label: string }[]; kind?: string; onKind?: (id: string) => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = useDesktop();
  const router = useRouter();
  const qc = useQueryClient();
  const kb = useKeyboardHeight();
  const preview = usePreview(active);
  const { user } = useAuth();
  const prepKey = keyFor(PREP_KEY, user?.username);
  // O que ficou escrito antes de a app recarregar (ou de o ecrã voltar a montar): volta como estava.
  const [initial] = useState<PrepForm>(() => decodePrep(keepRead(prepKey), Date.now()) ?? EMPTY_PREP);
  const [title, setTitle] = useState(initial.title);
  const [txKind, setTxKind] = useState<TxilladaKind>(initial.kind);
  const [closeOnly, setCloseOnly] = useState(initial.closeOnly);
  const [price, setPrice] = useState(initial.price);
  const [fund, setFund] = useState(initial.fund);
  const [goal, setGoal] = useState(initial.goal);
  const [purpose, setPurpose] = useState(initial.purpose);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const formRef = useRef<PrepForm>(initial);
  formRef.current = { title, kind: txKind, closeOnly, price, fund, goal, purpose };
  const save = useCallback(() => {
    const f = formRef.current;
    keepWrite(prepKey, prepIsEmpty(f) ? null : encodeKeep(f, Date.now()));
  }, [prepKey]);
  useEffect(save, [save, title, txKind, closeOnly, price, fund, goal, purpose]);
  // Ao sair de vista (outra app, ecrã bloqueado) guarda-se outra vez com a hora de agora: o rascunho conta a partir daí.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const away = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', away);
    window.addEventListener('pagehide', save);
    return () => { document.removeEventListener('visibilitychange', away); window.removeEventListener('pagehide', save); };
  }, [save]);

  // A escrever: um campo tem o foco (conta mais um bocadinho depois de o perder, enquanto o teclado fecha).
  const [typing, setTyping] = useState(false);
  const focused = useRef<string | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vv = useVisibleViewport();
  const webKb = Platform.OS === 'web' && typeof window !== 'undefined' && !!sheetViewport(vv, window.innerHeight, window.innerWidth);
  const writing = typing || kb > 0 || webKb;
  // O cartão é medido no próprio ecrã (no computador é a coluna do meio, não a janela) e sem o teclado: no iPhone o
  // react-native-web mede a janela pela zona visível e o cartão encolhia para metade.
  const [root, setRoot] = useState<Size>({ w: 0, h: 0 });
  const rootH = root.h || height;
  const still = useRef<Size>({ w: 0, h: 0 });
  still.current = stableScreen(still.current, { w: root.w || width, h: rootH }, writing);
  const frame = storyFrame({ w: still.current.w, h: still.current.h, top: insets.top, bottom: insets.bottom, wide });
  const vis = visibleArea({ web: Platform.OS === 'web', vv: webKb && vv ? { top: vv.top, height: vv.height } : null, rootH, screenH: still.current.h, kb: Platform.OS === 'web' ? 0 : kb });
  const panel = prepPanel({ cardTop: frame.cardTop, cardH: frame.cardH, visTop: vis.top, visBottom: vis.bottom });
  const narrow = frame.cardW < 360;
  const hint = kindHint(txKind, closeOnly);
  const clear = () => { if (msg) setMsg(null); };

  // Na web, com o teclado aberto, a página não rola por baixo (o Safari arrastava tudo para cima): fica no topo.
  useEffect(() => {
    if (!webKb || typeof window === 'undefined') return;
    const fix = () => { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); };
    fix();
    window.addEventListener('scroll', fix);
    return () => { window.removeEventListener('scroll', fix); fix(); };
  }, [webKb, vv?.top, vv?.height]);

  // O painel rola por dentro: o campo onde se escreve fica sempre à vista, por cima do teclado.
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const rows = useRef<Record<string, { y: number; h: number }>>({});
  const scrollY = useRef(0);
  const viewH = useRef(0);
  const row = (name: string) => (e: LayoutChangeEvent) => { rows.current[name] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }; };
  const show = useCallback((name: string | null) => {
    const r = name ? rows.current[name] : null;
    if (!r) return;
    const to = scrollToShow(r.y, r.h, scrollY.current, viewH.current);
    if (to != null) scroller.current?.scrollTo({ y: to, animated: true });
  }, []);
  useEffect(() => {
    if (!focused.current) return;
    const t = setTimeout(() => show(focused.current), 120);
    return () => clearTimeout(t);
  }, [panel.bottom, panel.maxHeight, fund, txKind, show]);
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);
  const onFocus = (name: string) => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    focused.current = name;
    setTyping(true);
    setTimeout(() => show(name), 60);
  };
  const onBlur = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => { focused.current = null; setTyping(false); }, 450);
  };

  // Os modos de Criar por baixo do cartão: o escolhido (a TXILLADA vem no fim) fica à vista num ecrã estreito.
  const modes = useRef<ComponentRef<typeof ScrollView>>(null);
  const modeX = useRef<Record<string, { x: number; w: number }>>({});
  const modesW = useRef(0);
  const showMode = useCallback(() => {
    const m = kind ? modeX.current[kind] : null;
    if (!m) return;
    const to = scrollToShow(m.x, m.w, 0, modesW.current, 12);
    if (to != null) modes.current?.scrollTo({ x: to, animated: false });
  }, [kind]);
  useEffect(showMode, [showMode, frame.cardW]);

  async function start() {
    const bad = titleError(title)
      ?? (txKind === 'paid' ? priceError(parseAmount(price)) : null)
      ?? (fund ? goalError(parseAmount(goal)) : null);
    if (bad) { setMsg(bad); return; }
    if (!preview.tracks) { setMsg(preview.error ?? 'A câmara ainda está a abrir.'); return; }
    setBusy(true);
    setMsg(null);
    try {
      const r = await txilladaApi.start(cleanTitle(title), prepAudience(txKind, closeOnly), {
        price: txKind === 'paid' ? parseAmount(price) : null,
        goal: fund ? parseAmount(goal) : null,
        purpose: fund ? purpose.replace(/\s+/g, ' ').trim().slice(0, PURPOSE_MAX) : '',
      });
      const tracks = preview.keep();
      handOff(r.txillada.id, { token: r.token, url: r.url }, tracks, preview.front);
      qc.setQueryData(txilladaKey(r.txillada.id), r.txillada);
      // Fica em TXILLADA por baixo (sem abrir outra câmara enquanto a do live está ligada); fora de foco, este ecrã sai.
      router.push(`/txillada/${r.txillada.id}` as never);
      setTitle('');
      setPurpose('');
    } catch (e) {
      // 409 com `id`: já tenho uma a decorrer (noutro aparelho, ou a app fechou a meio). Volto a entrar nela como
      // anfitrião, com a câmara que já está aberta aqui (o join dá ao anfitrião o token com canPublish).
      const running = e instanceof ApiError && e.status === 409 && typeof e.extra?.id === 'string' ? (e.extra.id as string) : null;
      if (running) {
        try {
          const access = await txilladaApi.join(running);
          handOff(running, access, preview.keep(), preview.front);
          router.push(`/txillada/${running}` as never);
          setTitle('');
        } catch (j) {
          setMsg(j instanceof ApiError ? errorText(j.status, j.message) : errorText(undefined));
        }
        return;
      }
      setMsg(e instanceof ApiError ? errorText(e.status, e.message) : errorText(undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={st.screen} onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; if (w !== root.w || h !== root.h) setRoot({ w, h }); }}>
      <View style={[st.card, { left: frame.cardLeft, top: frame.cardTop, width: frame.cardW, height: frame.cardH, borderRadius: frame.radius }]}>
        <TxilladaVideo track={preview.tracks?.video ?? null} mirror={preview.front} style={StyleSheet.absoluteFill} />
        {!preview.tracks && !preview.error && !writing ? <View style={[StyleSheet.absoluteFill, st.center]}><ActivityIndicator color="#fff" /></View> : null}
        {preview.error ? (
          <View style={[StyleSheet.absoluteFill, st.center, { paddingHorizontal: 24 }]}>
            <Icon name="camera" size={34} color="#fff" />
            <Text style={st.problem}>{preview.error}</Text>
            <Pressable onPress={preview.retry} style={st.retry} accessibilityRole="button"><Text style={st.retryText}>Tentar outra vez</Text></Pressable>
          </View>
        ) : null}

        <LinearGradient colors={['rgba(0,0,0,0.55)', 'transparent']} style={st.top} pointerEvents="box-none">
          <GlassButton icon="x" label="Fechar" onPress={onClose} />
          <View style={{ flex: 1, alignItems: 'center' }} pointerEvents="none"><Text style={st.heading}>Txillada</Text></View>
          <GlassButton icon="cam-flip" label="Virar a câmara" onPress={() => void preview.flip()} />
        </LinearGradient>

        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.8)']} locations={[0, 0.18, 1]} style={[st.bottom, { bottom: panel.bottom, maxHeight: panel.maxHeight }]} pointerEvents="box-none">
          <ScrollView
            ref={scroller}
            style={st.panelScroll}
            contentContainerStyle={st.panelBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
            scrollEventThrottle={32}
            onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
            onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
          >
          <View style={st.badgeLine} pointerEvents="none"><LiveBadge small /><Text style={st.badgeHint} numberOfLines={1}>Ao vivo, sem gravar</Text></View>
          <View style={st.field} onLayout={row('title')}>
            <TextInput
              value={title}
              onChangeText={(t) => { setTitle(t.slice(0, TITLE_MAX)); clear(); }}
              maxLength={TITLE_MAX}
              placeholder="Título (opcional)"
              placeholderTextColor="rgba(255,255,255,0.6)"
              style={st.input}
              returnKeyType="done"
              onFocus={onFocus('title')}
              onBlur={onBlur}
              accessibilityLabel="Título da Txillada"
            />
            <Text style={st.count}>{TITLE_MAX - title.length}</Text>
          </View>

          {/* O tipo: Pública, Para amigos, Privada (paga). Fica fixo depois de começar. */}
          <View style={st.kindRow} accessibilityRole="radiogroup" accessibilityLabel="Tipo de Txillada">
            {KINDS.map((k) => {
              const on = txKind === k.id;
              return (
                <Pressable
                  key={k.id}
                  onPress={() => { setTxKind(k.id); clear(); }}
                  style={({ pressed }) => [st.kindCard, on && st.kindCardOn, pressed && { transform: [{ scale: 0.97 }] }]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${k.label}. ${k.hint}`}
                >
                  <Icon name={k.icon} size={18} color="#fff" strokeWidth={2.1} />
                  <Text style={[st.kindLabel, narrow && st.kindLabelNarrow, !on && { color: 'rgba(255,255,255,0.86)' }]} numberOfLines={2}>{k.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {txKind === 'friends' ? (
            <Toggle label="Só amigos próximos" sub="A tua lista dos mimos" icon="star" on={closeOnly} onChange={(v) => { setCloseOnly(v); clear(); }} />
          ) : null}
          {txKind === 'paid' ? (
            <View style={st.priceRow} onLayout={row('price')}>
              <Icon name="lock" size={16} color="#fff" strokeWidth={2.2} />
              <Text style={st.priceLabel}>Entrada</Text>
              <View style={st.amount}>
                <TextInput
                  value={price}
                  onChangeText={(t) => { setPrice(t.replace(/[^\d]/g, '').slice(0, 4)); clear(); }}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  placeholder={String(PRICE_MIN * 10)}
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={st.amountInput}
                  maxLength={4}
                  onFocus={onFocus('price')}
                  onBlur={onBlur}
                  accessibilityLabel={`Preço da entrada em vibes, de ${PRICE_MIN} a ${PRICE_MAX}`}
                />
                <Text style={st.amountUnit}>vib</Text>
              </View>
            </View>
          ) : null}
          <Text style={st.hint}>{txKind === 'paid' ? `${hint}. Tu e quem convidares para transmitir entram sem pagar.` : hint}</Text>

          {/* A Angariação: uma meta em Txills e para quê; quem vê oferece Txills e a barra enche-se. */}
          <Toggle label="Angariação" sub="Uma meta em vibes que quem vê ajuda a encher" icon="present" on={fund} onChange={(v) => { setFund(v); clear(); }} />
          {fund ? (
            <View style={st.fundRow} onLayout={row('fund')}>
              <View style={[st.amount, { width: narrow ? 108 : 128, minWidth: 0 }]}>
                <TextInput
                  value={goal}
                  onChangeText={(t) => { setGoal(t.replace(/[^\d]/g, '').slice(0, 7)); clear(); }}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  placeholder="Meta"
                  placeholderTextColor="rgba(255,255,255,0.5)"
                  style={st.amountInput}
                  maxLength={7}
                  onFocus={onFocus('fund')}
                  onBlur={onBlur}
                  accessibilityLabel="Meta da angariação em vibes"
                />
                <Text style={st.amountUnit}>vib</Text>
              </View>
              <TextInput
                value={purpose}
                onChangeText={(t) => { setPurpose(t.slice(0, PURPOSE_MAX)); clear(); }}
                maxLength={PURPOSE_MAX}
                placeholder="Para quê? (opcional)"
                placeholderTextColor="rgba(255,255,255,0.55)"
                style={st.purpose}
                onFocus={onFocus('fund')}
                onBlur={onBlur}
                accessibilityLabel="Para que é a angariação"
              />
            </View>
          ) : null}

          {msg ? <Text style={st.msg} accessibilityRole="alert">{msg}</Text> : null}
          <Pressable onPress={() => void start()} disabled={busy} style={({ pressed }) => [st.go, (busy || !preview.tracks) && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : <><Icon name="txillada" size={22} color="#fff" strokeWidth={2.1} /><Text style={st.goText}>Começar Txillada</Text></>}
          </Pressable>
          </ScrollView>
        </LinearGradient>
      </View>

      {kinds && onKind ? (
        <View style={[st.modes, { top: frame.barTop, height: frame.barH, left: frame.cardLeft, width: frame.cardW }]}>
          <ScrollView ref={modes} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.kinds} accessibilityRole="tablist" onLayout={(e) => { modesW.current = e.nativeEvent.layout.width; showMode(); }}>
            {kinds.map((kd) => (
              <Pressable key={kd.id} onPress={() => onKind(kd.id)} onLayout={(e) => { modeX.current[kd.id] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; if (kd.id === kind) showMode(); }} style={st.kindPill} accessibilityRole="tab" accessibilityLabel={kd.label} accessibilityState={{ selected: kind === kd.id }} hitSlop={6}>
                <Text style={[st.kindText, kind === kd.id && st.kindOn]}>{kd.label.toUpperCase()}</Text>
                <View style={[st.kindDot, kind !== kd.id && { opacity: 0 }]} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** Um interruptor no vidro escuro (o ícone, o texto, a explicação e a bolinha). */
function Toggle({ label, sub, icon, on, onChange }: { label: string; sub: string; icon: 'star' | 'present'; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!on)} style={({ pressed }) => [st.toggle, on && st.toggleOn, pressed && { opacity: 0.9 }]} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={`${label}. ${sub}`}>
      <Icon name={icon} size={16} color={on ? colors.brandWarm : '#fff'} strokeWidth={2.2} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.toggleLabel} numberOfLines={1}>{label}</Text>
        <Text style={st.toggleSub} numberOfLines={2}>{sub}</Text>
      </View>
      <View style={[st.track, on && st.trackOn]}><View style={[st.thumb, on && st.thumbOn]} /></View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  card: { position: 'absolute', overflow: 'hidden', backgroundColor: colors.zinc900 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  problem: { color: '#fff', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  retry: { marginTop: 6, height: 42, paddingHorizontal: 20, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 28 },
  heading: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 28 },
  panelScroll: { flexGrow: 0, flexShrink: 1 },
  panelBody: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 16, gap: 9 },
  badgeLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badgeHint: { flexShrink: 1, color: 'rgba(255,255,255,0.8)', fontSize: 12.5, fontWeight: '600' },
  field: { flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: 23, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(14,14,18,0.5)', paddingRight: 14 },
  input: { flex: 1, minWidth: 0, height: 44, paddingLeft: 18, paddingRight: 8, color: '#fff', fontSize: 16, fontWeight: '600', outlineStyle: 'none' as never },
  count: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  kindRow: { flexDirection: 'row', gap: 6 },
  kindCard: { flex: 1, minWidth: 0, minHeight: 56, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(14,14,18,0.45)', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 4 },
  kindCardOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  kindLabel: { color: '#fff', fontSize: 13, lineHeight: 16, fontWeight: '800', letterSpacing: -0.1, textAlign: 'center' },
  kindLabelNarrow: { fontSize: 12, lineHeight: 15, letterSpacing: -0.2 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 14, paddingRight: 4, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(14,14,18,0.5)' },
  priceLabel: { flex: 1, color: '#fff', fontSize: 14.5, fontWeight: '700' },
  amount: { flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', paddingRight: 12, minWidth: 112 },
  amountInput: { flex: 1, minWidth: 0, height: 36, paddingLeft: 12, paddingRight: 4, color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'right', fontVariant: ['tabular-nums'], outlineStyle: 'none' as never },
  amountUnit: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700' },
  hint: { color: 'rgba(255,255,255,0.72)', fontSize: 12.5, lineHeight: 17, textAlign: 'center', marginTop: -2 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(14,14,18,0.45)' },
  toggleOn: { borderColor: 'rgba(255,154,91,0.6)' },
  toggleLabel: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  toggleSub: { color: 'rgba(255,255,255,0.65)', fontSize: 12, lineHeight: 16 },
  track: { width: 38, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.25)', padding: 2, justifyContent: 'center' },
  trackOn: { backgroundColor: colors.brand },
  thumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  thumbOn: { transform: [{ translateX: 16 }] },
  fundRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  purpose: { flex: 1, minWidth: 0, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 14, color: '#fff', fontSize: 14, fontWeight: '600', outlineStyle: 'none' as never },
  msg: { color: '#fff', backgroundColor: 'rgba(220,38,38,0.85)', borderRadius: 12, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  go: { height: 50, borderRadius: 25, backgroundColor: colors.brand, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(214,51,79,0.45)' } as object,
  goText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  modes: { position: 'absolute', justifyContent: 'center' },
  kinds: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 0, paddingHorizontal: 6 },
  kindPill: { minHeight: 44, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', justifyContent: 'center', gap: 4 },
  kindDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.brand },
  kindText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  kindOn: { color: '#fff' },
});
