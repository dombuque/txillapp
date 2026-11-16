import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { CallIcon } from '@/components/calls/CallIcons';
import { TxilladaVideo } from '@/components/txillada/TxilladaVideo';
import { colors } from '@/lib/theme';
import type { TxilladaPerson } from '@/lib/txillada';
import { GUESTS_MAX, labelOffset, stageLayout, type GuestPending, type GuestsState } from '@/lib/txilladaGuests';
import type { StageTile } from '@/lib/txilladaRoom';

/**
 * A Txillada com convidados (0165, docs/txillada-contrato.md): o ecrã com até 4 pessoas, o cartão do convite e a lista dos
 * convidados do anfitrião (quem transmite, os pedidos e os convites à espera). A lógica pura está em lib/txilladaGuests.
 */

const glass = Platform.OS === 'web' ? ({ backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' } as object) : {};

/**
 * O ecrã: 1 pessoa = o vídeo de ponta a ponta (como sempre); 2 = uma em cima da outra ao alto (lado a lado num ecrã
 * deitado); 3 = o anfitrião grande em cima e dois em baixo; 4 = grelha 2×2 (lib/txilladaGuests `stageLayout`). Cada quadrado
 * com o @ e o selo, o microfone calado e, quem fala, um contorno coral. `headerBottom`: onde acaba o cabeçalho do ecrã (a
 * etiqueta dos quadrados de cima vai por baixo dele). No computador (`wide`) a imagem fica inteira com o fundo desfocado.
 */
export function TxilladaStage({ tiles, w, h, headerBottom, wide }: { tiles: readonly StageTile[]; w: number; h: number; headerBottom: number; wide: boolean }) {
  if (tiles.length <= 1) {
    const t = tiles[0];
    return <TxilladaVideo track={t?.track ?? null} mirror={!!t?.mirror} fit={t?.local ? 'cover' : 'auto'} style={StyleSheet.absoluteFill} />;
  }
  const rects = stageLayout(tiles.length, w, h);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityLabel={`${tiles.length} pessoas a transmitir`}>
      {tiles.map((t, i) => {
        const r = rects[i];
        if (!r) return null;
        const small = r.w < 240;
        return (
          <View key={t.person.id} style={[st.tile, { left: r.x, top: r.y, width: r.w, height: r.h }]} testID="txillada-tile">
            <TxilladaVideo track={t.track} mirror={t.mirror} fit={wide ? 'auto' : 'cover'} box={{ w: r.w, h: r.h }} style={StyleSheet.absoluteFill} />
            {!t.track ? (
              <View style={[StyleSheet.absoluteFill, st.center]}>
                <Avatar name={t.person.displayName} username={t.person.avatarUrl ? t.person.username : undefined} size={small ? 52 : 72} />
              </View>
            ) : null}
            {t.speaking ? <View style={[StyleSheet.absoluteFill, st.speaking]} /> : null}
            <View style={[st.label, { top: labelOffset(r, headerBottom), maxWidth: r.w - 16 }]}>
              <NameWithBadge name={`@${t.person.username}`} who={t.person} style={[st.labelText, small && { fontSize: 12 }]} containerStyle={{ flexShrink: 1 }} />
              {!t.mic ? <CallIcon name="mic-off" size={small ? 12 : 14} color="#fff" /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** O convite do anfitrião (quem vê): «@fulano convidou-te para transmitir», aceitar ou recusar. */
export function InviteCard({ inviter, busy, onAccept, onDecline }: { inviter: { username: string; displayName: string; avatarUrl: string | null; verified?: boolean; verifiedTier?: TxilladaPerson['verifiedTier'] } | null; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  return (
    <View style={st.inviteWrap} pointerEvents="box-none">
      <View style={st.invite} accessibilityRole="alert">
        {inviter ? <Avatar name={inviter.displayName} username={inviter.avatarUrl ? inviter.username : undefined} size={52} /> : null}
        <View style={st.inviteWho}>
          {inviter ? <NameWithBadge name={`@${inviter.username}`} who={inviter} style={st.inviteName} center /> : null}
          <Text style={st.inviteText}>convidou-te para transmitir na Txillada</Text>
          <Text style={st.inviteSub}>A tua câmara e o teu microfone passam a aparecer a quem está a ver.</Text>
        </View>
        <View style={st.inviteRow}>
          <Pressable onPress={onDecline} disabled={busy} style={({ pressed }) => [st.btn, st.btnGhost, pressed && st.pressed]} accessibilityRole="button">
            <Text style={st.btnGhostText}>Recusar</Text>
          </Pressable>
          <Pressable onPress={onAccept} disabled={busy} style={({ pressed }) => [st.btn, st.btnBrand, pressed && st.pressed, busy && { opacity: 0.6 }]} accessibilityRole="button">
            <Text style={st.btnBrandText}>{busy ? 'A abrir a câmara…' : 'Aceitar'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Uma fila da lista dos convidados (no painel branco). */
function Row({ p, children }: { p: GuestPending | { user: TxilladaPerson }; children: React.ReactNode }) {
  const u = p.user;
  return (
    <View style={st.row}>
      <Avatar name={u.displayName} username={u.avatarUrl ? u.username : undefined} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <NameWithBadge name={u.displayName} who={u} style={st.rowName} />
        <Text style={st.rowUser} numberOfLines={1}>@{u.username}</Text>
      </View>
      <View style={st.rowBtns}>{children}</View>
    </View>
  );
}

function Small({ label, kind = 'ghost', onPress, disabled }: { label: string; kind?: 'ghost' | 'brand' | 'danger'; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={4} style={({ pressed }) => [st.small, kind === 'brand' ? st.smallBrand : st.smallGhost, pressed && st.pressed, disabled && { opacity: 0.45 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={[st.smallText, kind === 'brand' && { color: '#fff' }, kind === 'danger' && { color: colors.red600 }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * O anfitrião: quem transmite (tirar), os pedidos para entrar (aceitar até 3, recusar) e os convites à espera (retirar).
 * Convidar faz-se em «A ver agora».
 */
export function GuestsPanel({ s, onAccept, onDecline, onRemove, onOpenViewers }: { s: GuestsState; onAccept: (u: string) => void; onDecline: (u: string) => void; onRemove: (u: string) => void; onOpenViewers: () => void }) {
  const full = s.guests.length >= GUESTS_MAX;
  return (
    <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 8 }}>
      <Text style={st.section}>A transmitir contigo · {s.guests.length}/{GUESTS_MAX}</Text>
      {s.guests.length ? s.guests.map((g) => (
        <Row key={g.user.id} p={g}><Small label="Tirar" kind="danger" onPress={() => onRemove(g.user.username)} /></Row>
      )) : <Text style={st.empty}>Ninguém está a transmitir contigo.</Text>}
      <Text style={st.section}>Pedidos para entrar{s.requests.length ? ` · ${s.requests.length}` : ''}</Text>
      {s.requests.length ? s.requests.map((g) => (
        <Row key={g.user.id} p={g}>
          <Small label="Recusar" onPress={() => onDecline(g.user.username)} />
          <Small label="Aceitar" kind="brand" disabled={full} onPress={() => onAccept(g.user.username)} />
        </Row>
      )) : <Text style={st.empty}>Ainda ninguém pediu para entrar.</Text>}
      {full && s.requests.length ? <Text style={st.hint}>Já há {GUESTS_MAX} a transmitir: tira alguém para aceitares outro pedido.</Text> : null}
      {s.invites.length ? (
        <>
          <Text style={st.section}>Convites à espera</Text>
          {s.invites.map((g) => <Row key={g.user.id} p={g}><Small label="Retirar" onPress={() => onRemove(g.user.username)} /></Row>)}
        </>
      ) : null}
      <Pressable onPress={onOpenViewers} style={({ pressed }) => [st.viewersLink, pressed && { opacity: 0.7 }]} accessibilityRole="button">
        <Icon name="user-plus" size={18} color={colors.brand} strokeWidth={2} />
        <Text style={st.viewersLinkText}>Convidar alguém de «A ver agora»</Text>
      </Pressable>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  tile: { position: 'absolute', overflow: 'hidden', backgroundColor: '#101014' },
  center: { alignItems: 'center', justifyContent: 'center' },
  speaking: { borderWidth: 3, borderColor: colors.brand },
  label: { position: 'absolute', left: 8, flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: 'rgba(14,14,18,0.55)' },
  labelText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  inviteWrap: { position: 'absolute', left: 0, right: 0, top: '26%', zIndex: 12, elevation: 12, alignItems: 'center', paddingHorizontal: 20 },
  invite: { width: '100%', maxWidth: 360, alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 20, borderRadius: 22, backgroundColor: 'rgba(14,14,18,0.82)', borderWidth: 1, borderColor: 'rgba(255,154,91,0.45)', ...glass },
  inviteWho: { alignItems: 'center', gap: 3 },
  inviteName: { color: '#fff', fontSize: 17, fontWeight: '800' },
  inviteText: { color: '#fff', fontSize: 15.5, fontWeight: '600', textAlign: 'center' },
  inviteSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 18 },
  inviteRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  btn: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  btnGhostText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnBrand: { backgroundColor: colors.brand },
  btnBrandText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  pressed: { transform: [{ scale: 0.96 }] },
  section: { marginTop: 10, marginBottom: 2, paddingHorizontal: 4, color: colors.zinc500, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { paddingHorizontal: 4, paddingVertical: 10, color: colors.zinc500, fontSize: 14.5 },
  hint: { paddingHorizontal: 4, paddingBottom: 6, color: colors.zinc500, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 4 },
  rowName: { color: colors.zinc900, fontSize: 15.5, fontWeight: '700' },
  rowUser: { color: colors.zinc500, fontSize: 13.5, marginTop: 1 },
  rowBtns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  small: { height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  smallGhost: { backgroundColor: colors.zinc100 },
  smallBrand: { backgroundColor: colors.brand },
  smallText: { color: colors.zinc900, fontSize: 14, fontWeight: '700' },
  viewersLink: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  viewersLinkText: { color: colors.brand, fontSize: 15, fontWeight: '700' },
});
