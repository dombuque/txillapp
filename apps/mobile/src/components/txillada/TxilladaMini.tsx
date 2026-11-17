import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { TxilladaVideo } from '@/components/txillada/TxilladaVideo';
import { txilladaApi } from '@/lib/api.txillada';
import { useAuth } from '@/lib/auth';
import { useDesktop } from '@/lib/desktop';
import { colors } from '@/lib/theme';
import { decodeOpen, isTap, miniMode, miniPillText, miniSize, miniSnap, miniStart, onTxilladaScreen, type OpenTxillada, type Pos } from '@/lib/txilladaMini';
import { clearOpen, closeTxillada, readOpen, useActiveTxillada, useTxilladaSession, type TxilladaSession } from '@/lib/txilladaSession';

/**
 * A Txillada fora do ecrã dela (lib/txilladaSession): por cima de qualquer ecrã da app.
 * - Quem vê: um leitor pequeno com o vídeo (9:16), que se arrasta e fica encostado a um lado; um toque volta à Txillada,
 *   o X sai de vez. O som continua.
 * - O anfitrião (e quem transmite como convidado): a pílula «Estás ao vivo · Voltar» por cima da barra dos separadores. A
 *   transmissão não acaba por sair do ecrã.
 * - Acabada: «A Txillada acabou» (o anfitrião: «Ver o resumo»), com o X.
 * - Depois de a PWA recarregar: «Estavas na Txillada de @zeca · Voltar», se ainda está a decorrer.
 */
export function TxilladaMini() {
  const id = useActiveTxillada();
  const pathname = usePathname();
  if (!id) return <TxilladaResume pathname={pathname} />;
  return <Mini id={id} pathname={pathname} />;
}

function useSafe() {
  const insets = useSafeAreaInsets();
  const wide = useDesktop();
  // A barra dos separadores flutua em baixo (58 + a margem segura + 8, app/(tabs)/_layout): o leitor fica por cima dela.
  const bottom = wide ? 20 : 58 + Math.max(insets.bottom, 8) + 8 + 4;
  return { top: Math.max(insets.top, 8) + 4, bottom };
}

function Mini({ id, pathname }: { id: string; pathname: string }) {
  const tx = useTxilladaSession(id);
  const router = useRouter();
  const onScreen = onTxilladaScreen(pathname, id);
  if (!tx || !tx.dto) return null;
  const onStage = !tx.host && tx.guests.mine === 'guest';
  const mode = miniMode({ onScreen, kind: tx.kind === 'locked' || tx.kind === 'error' ? 'none' : tx.kind, host: tx.host, onStage });
  if (mode === 'none') return null;
  const back = () => router.push(`/txillada/${encodeURIComponent(id)}` as never);
  if (mode === 'video') return <MiniPlayer tx={tx} onOpen={back} />;
  return <MiniPill text={miniPillText(mode, { host: tx.host, hostUsername: tx.dto.host.username })} live={mode !== 'ended'} onOpen={back} onClose={mode === 'host' ? undefined : () => closeTxillada()} />;
}

/** A pílula (o anfitrião, quem transmite, a Txillada acabada e o voltar depois de recarregar). */
function MiniPill({ text, live, onOpen, onClose }: { text: string; live: boolean; onOpen: () => void; onClose?: () => void }) {
  const safe = useSafe();
  return (
    <View style={[st.pillWrap, { bottom: safe.bottom }]} pointerEvents="box-none">
      <View style={st.pill}>
        <Pressable onPress={onOpen} style={({ pressed }) => [st.pillMain, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={text} testID="txillada-mini-pill">
          {live ? <View style={st.dot} /> : <Icon name="clock" size={14} color="#fff" strokeWidth={2.2} />}
          <Text style={st.pillText} numberOfLines={1}>{text}</Text>
        </Pressable>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={8} style={st.pillX} accessibilityRole="button" accessibilityLabel="Sair da Txillada">
            <Icon name="x" size={16} color="#fff" strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** O leitor pequeno com o vídeo de quem transmite (arrasta-se; um toque volta à Txillada). */
function MiniPlayer({ tx, onOpen }: { tx: TxilladaSession; onOpen: () => void }) {
  const win = useWindowDimensions();
  const safe = useSafe();
  const size = miniSize({ w: win.width, h: win.height });
  const start = miniStart(size, { w: win.width, h: win.height }, safe);
  const pos = useRef(new Animated.ValueXY(start)).current;
  const at = useRef<Pos>(start);
  const t0 = useRef(0);
  const box = useRef({ size, win: { w: win.width, h: win.height }, safe });
  box.current = { size, win: { w: win.width, h: win.height }, safe };
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  // A janela mudou (rodar, o teclado): volta a encostar dentro do ecrã.
  useEffect(() => {
    const p = miniSnap(at.current, size, { w: win.width, h: win.height }, safe);
    at.current = p;
    pos.setValue(p);
  }, [win.width, win.height, size.w, size.h, safe.top, safe.bottom]); // eslint-disable-line react-hooks/exhaustive-deps
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
    onPanResponderGrant: () => { t0.current = Date.now(); },
    onPanResponderMove: (_e, g) => pos.setValue({ x: at.current.x + g.dx, y: at.current.y + g.dy }),
    onPanResponderRelease: (_e, g) => {
      if (isTap(g.dx, g.dy, Date.now() - t0.current)) {
        pos.setValue(at.current);
        openRef.current();
        return;
      }
      const b = box.current;
      const p = miniSnap({ x: at.current.x + g.dx, y: at.current.y + g.dy }, b.size, b.win, b.safe);
      at.current = p;
      Animated.spring(pos, { toValue: p, useNativeDriver: Platform.OS !== 'web', friction: 8, tension: 70 }).start();
    },
    onPanResponderTerminate: () => pos.setValue(at.current),
  })).current;
  const dto = tx.dto!;
  const track = tx.tiles[0]?.track ?? null;
  return (
    <Animated.View style={[st.player, { width: size.w, height: size.h, transform: pos.getTranslateTransform() }]} testID="txillada-mini">
      <View style={StyleSheet.absoluteFill} {...pan.panHandlers} accessibilityRole="button" accessibilityLabel={`Voltar à Txillada de ${dto.host.username}`}>
        {track ? (
          <TxilladaVideo track={track} fit="cover" box={size} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, st.center]}>
            <Avatar name={dto.host.displayName} username={dto.host.avatarUrl ? dto.host.username : undefined} size={44} />
          </View>
        )}
        <View style={st.live} pointerEvents="none"><Text style={st.liveText}>AO VIVO</Text></View>
        <View style={st.who} pointerEvents="none">
          <NameWithBadge name={`@${dto.host.username}`} who={dto.host} style={st.whoText} containerStyle={{ flexShrink: 1 }} />
        </View>
      </View>
      <Pressable onPress={() => closeTxillada()} hitSlop={8} style={st.x} accessibilityRole="button" accessibilityLabel="Sair da Txillada">
        <Icon name="x" size={15} color="#fff" strokeWidth={2.6} />
      </Pressable>
      {tx.audioBlocked ? (
        <Pressable onPress={() => void tx.startAudio()} style={st.sound} accessibilityRole="button" accessibilityLabel="Ligar o som">
          <Icon name="volume" size={14} color="#fff" strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/** Depois de a PWA recarregar (ou a app voltar à memória): a Txillada que estava aberta, se ainda está a decorrer. */
function TxilladaResume({ pathname }: { pathname: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const [o, setO] = useState<OpenTxillada | null>(null);
  const [alive, setAlive] = useState(false);
  useEffect(() => {
    const k = decodeOpen(readOpen(user?.username), Date.now());
    setO(k);
    setAlive(false);
    if (!k) return;
    let dead = false;
    void txilladaApi.get(k.id).then(
      (d) => { if (!dead) { if (d?.status === 'live') setAlive(true); else clearOpen(user?.username); } },
      () => { if (!dead) clearOpen(user?.username); },
    );
    return () => { dead = true; };
  }, [user?.username]);
  if (!o || !alive || onTxilladaScreen(pathname, o.id)) return null;
  const drop = () => { clearOpen(user?.username); setO(null); };
  return (
    <MiniPill
      text={o.isHost ? 'A tua Txillada está ao vivo · Voltar' : `Estavas na Txillada de @${o.host} · Voltar`}
      live
      onOpen={() => { setO(null); router.push(`/txillada/${encodeURIComponent(o.id)}` as never); }}
      onClose={drop}
    />
  );
}

const st = StyleSheet.create({
  pillWrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 900, elevation: 30 },
  pill: { flexDirection: 'row', alignItems: 'center', maxWidth: 420, height: 42, borderRadius: 21, backgroundColor: colors.brand, paddingLeft: 4, paddingRight: 4, boxShadow: '0 6px 18px rgba(0,0,0,0.25)' } as object,
  pillMain: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingLeft: 12, paddingRight: 8 },
  pillText: { flexShrink: 1, color: '#fff', fontSize: 14, fontWeight: '800' },
  pillX: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  player: { position: 'absolute', left: 0, top: 0, zIndex: 900, elevation: 30, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', boxShadow: '0 10px 28px rgba(0,0,0,0.35)' } as object,
  center: { alignItems: 'center', justifyContent: 'center' },
  live: { position: 'absolute', top: 7, left: 7, paddingHorizontal: 5, height: 17, borderRadius: 4, backgroundColor: colors.brand, justifyContent: 'center' },
  liveText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  who: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 7, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.38)' },
  whoText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  x: { position: 'absolute', top: 5, right: 5, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  sound: { position: 'absolute', top: 36, right: 5, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
});
