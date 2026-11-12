import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BookmarkIcon } from '@/components/BookmarkIcon';
import { Icon } from '@/components/Icon';
import { DARK, Sheet } from '@/components/Sheet';
import { holdMenu, SPEEDS, speedLabel, type HoldItem } from '@/lib/reelView';

/**
 * O menu de segurar o dedo numa tcheka (como no TikTok): em cima três atalhos grandes (Não me interessa, Denunciar,
 * Guardar), depois a velocidade (0,5× a 2×), as legendas (se o vídeo as tiver), presentear e o menu ⋯ de sempre.
 * A tcheka continua a tocar por trás.
 */
export function HoldMenu({ mine, saved, canGift, speed, captions, captionsOn, onPick, onSpeed, onClose }: {
  mine: boolean;
  saved: boolean;
  canGift: boolean;
  speed: number;
  /** O vídeo tem legendas. */
  captions: boolean;
  captionsOn: boolean;
  onPick: (item: Exclude<HoldItem, 'speed'>) => void;
  onSpeed: (rate: number) => void;
  onClose: () => void;
}) {
  const items = holdMenu({ mine, captions, canGift });
  const tile = (id: Exclude<HoldItem, 'speed'>, icon: ReactNode, label: string, on = false) => (
    <Pressable key={id} onPress={() => onPick(id)} style={({ pressed }) => [st.tile, pressed && { backgroundColor: DARK.hover }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <View style={st.tileIcon}>{icon}</View>
      <Text style={st.tileText} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
  const row = (id: Exclude<HoldItem, 'speed'>, icon: ReactNode, label: string, right?: ReactNode) => (
    <Pressable key={id} onPress={() => onPick(id)} style={({ pressed }) => [st.row, pressed && { backgroundColor: DARK.hover }]} accessibilityRole="button">
      {icon}
      <Text style={st.rowText}>{label}</Text>
      {right}
    </Pressable>
  );
  return (
    <Sheet onClose={onClose} dark variant="dialog" title="Opções">
      <View style={st.wrap} accessibilityLabel="Opções da tcheka">
        <View style={st.tiles}>
          {items.includes('not-interested') && tile('not-interested', <Icon name="eye-off" size={24} color="#fff" />, 'Não me interessa')}
          {items.includes('report') && tile('report', <Icon name="flag" size={24} color="#fff" />, 'Denunciar')}
          {tile('save', <BookmarkIcon on={saved} size={24} color="#fff" />, saved ? 'Guardado' : 'Guardar', saved)}
        </View>

        <Text style={st.label}>Velocidade</Text>
        <View style={st.speeds} accessibilityRole="radiogroup">
          {SPEEDS.map((r) => {
            const on = Math.abs(r - speed) < 0.01;
            return (
              <Pressable key={r} onPress={() => onSpeed(r)} style={[st.speed, on && st.speedOn]} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`Velocidade ${speedLabel(r)}`}>
                <Text style={[st.speedText, on && { color: '#000' }]}>{speedLabel(r)}</Text>
              </Pressable>
            );
          })}
        </View>

        {items.includes('captions') && row('captions', <Icon name="file-text" size={22} color="#fff" />, 'Legendas', <Text style={st.rowRight}>{captionsOn ? 'Ligadas' : 'Desligadas'}</Text>)}
        {items.includes('gift') && row('gift', <Icon name="gift" size={22} color="#fff" />, 'Presentear')}
        {row('more', <Icon name="more" size={22} color="#fff" strokeWidth={3} />, 'Mais opções')}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 8 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, minHeight: 88, borderRadius: 16, backgroundColor: '#2a2a2d', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 6, paddingVertical: 12 },
  tileIcon: { height: 26, alignItems: 'center', justifyContent: 'center' },
  tileText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  label: { marginTop: 20, marginBottom: 10, color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  speeds: { flexDirection: 'row', gap: 6 },
  speed: { flex: 1, height: 38, borderRadius: 19, backgroundColor: '#2a2a2d', alignItems: 'center', justifyContent: 'center' },
  speedOn: { backgroundColor: '#fff' },
  speedText: { color: '#fff', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  row: { marginTop: 8, minHeight: 50, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14 },
  rowText: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600' },
  rowRight: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
});
