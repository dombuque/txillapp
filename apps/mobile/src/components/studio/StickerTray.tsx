import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api, type MentionSuggestion } from '@/lib/api';
import { gifsApi } from '@/lib/api.gifs';
import type { GifItem } from '@/lib/gifs';
import { ANIMS, LOOPS, type AnimIn, type StickerContent, type StickerOverlay } from '@/lib/studio/effects';
import { STICKERS, STICKER_CATS } from '@/lib/stickers';
import { fmtS } from '@/lib/tchekaRules';
import { useGifsConfig } from '../GifPanel';
import { Icon } from '../Icon';
import { StickerArt } from '../Stickers';
import { fx as ui, FxAction, FxChip, FxRow, FxSegment, FxSlider, fxc } from './FxUi';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;
type Sub = 'emoji' | 'txill' | 'gif' | 'mention' | 'location' | 'time';
const SUBS: { id: Sub; label: string }[] = [
  { id: 'emoji', label: 'Emoji' }, { id: 'txill', label: 'Txill' }, { id: 'gif', label: 'GIF' }, { id: 'mention', label: '@' }, { id: 'location', label: 'Local' }, { id: 'time', label: 'Hora' },
];
const EMOJIS = ['🔥', '😂', '❤️', '😍', '🥳', '🇲🇿', '🌴', '🌊', '☀️', '🎉', '💃', '🕺', '🎶', '✨', '💯', '👏', '🙌', '😎', '🤩', '😭', '🥰', '👀', '💥', '⚡', '🌶️', '🍻', '🥥', '🥭', '🏖️', '⚽', '🏆', '📍', '🎤', '🎧', '🫶', '💪', '🙏', '😜', '🤣', '😱', '👑', '🌅', '🦐', '🐠', '🛶', '🚀', '💐', '🎂'];
const PLACES = ['Maputo', 'Matola', 'Costa do Sol', 'Beira', 'Nampula', 'Inhambane', 'Tofo', 'Vilankulo', 'Ponta do Ouro', 'Bilene', 'Xai-Xai', 'Ilha de Moçambique', 'Pemba', 'Quelimane', 'Tete', 'Chimoio', 'Lichinga'];

/**
 * O separador «Stickers»: emojis grandes, os stickers do Txillapp, GIFs do GIPHY (pelo nosso servidor, como no chat), menções,
 * o local e a hora. Cada um mexe-se na pré-visualização e pode pulsar ou balançar.
 */
export function StickerTray({ stickers, selId, onSelect, onAdd, onChange, onDelete, total, locked }: {
  stickers: StickerOverlay[];
  selId: string | null;
  onSelect: (id: string) => void;
  onAdd: (c: StickerContent) => void;
  onChange: (o: StickerOverlay) => void;
  onDelete: (id: string) => void;
  total: number;
  locked: boolean;
}) {
  const [sub, setSub] = useState<Sub>('emoji');
  const cur = stickers.find((s) => s.id === selId) ?? null;
  const add = (c: StickerContent) => { if (!locked && stickers.length < 16) onAdd(c); };
  const set = (patch: Partial<StickerOverlay>) => { if (cur && !locked) onChange({ ...cur, ...patch }); };
  const isLabel = cur && (cur.sticker.type === 'mention' || cur.sticker.type === 'location' || cur.sticker.type === 'time');

  return (
    <View>
      {cur ? (
        <View style={{ marginHorizontal: 12, marginTop: 8, padding: 4, paddingBottom: 10, borderRadius: 18, backgroundColor: 'rgba(255,92,108,0.07)', borderWidth: 1, borderColor: 'rgba(255,92,108,0.35)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 6 }}>
            <Text style={[ui.label, { flex: 1, color: '#fff' }]}>Sticker escolhido</Text>
            <FxAction label="Pronto" onPress={() => onSelect('')} a11y="Deixar de mexer neste sticker" />
            <FxAction label="Apagar" tone="danger" icon={<Icon name="trash" size={13} color="#fff" />} onPress={() => onDelete(cur.id)} a11y="Apagar este sticker" />
          </View>
          {isLabel ? (
            <FxRow label="Estilo">
              {(['branco', 'coral', 'escuro'] as const).map((v) => <FxChip key={v} small on={cur.variant === v} label={v === 'branco' ? 'Branco' : v === 'coral' ? 'Coral' : 'Escuro'} onPress={() => set({ variant: v })} />)}
            </FxRow>
          ) : null}
          <FxRow label="Animação">
            {LOOPS.map((a) => <FxChip key={a.id} small on={cur.anim.loop === a.id} label={a.name} onPress={() => set({ anim: { ...cur.anim, loop: a.id } })} a11y={`Em ciclo: ${a.name}`} />)}
            <View style={{ width: 10 }} />
            {ANIMS.filter((a) => a.id !== 'maquina' && a.id !== 'ondulacao').map((a) => <FxChip key={a.id} small on={cur.anim.in === a.id} label={`Entra: ${a.name}`} onPress={() => set({ anim: { ...cur.anim, in: a.id as AnimIn } })} />)}
          </FxRow>
          <FxSlider label="Aparece de" value={cur.start} min={0} max={Math.max(0.5, total - 0.5)} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => set({ start: v, end: Math.max(cur.end, v + 0.5) })} />
          <FxSlider label="Até" value={Math.min(cur.end, Math.max(0.6, total))} min={0.5} max={Math.max(0.6, total)} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => set({ end: v, start: Math.min(cur.start, v - 0.5) })} />
        </View>
      ) : null}

      <FxSegment items={SUBS} value={sub} onChange={setSub} />
      {stickers.length ? (
        <FxRow>
          {stickers.map((s, k) => <FxChip key={s.id} small on={s.id === selId} label={stickerName(s.sticker) || `Sticker ${k + 1}`} onPress={() => onSelect(s.id)} />)}
        </FxRow>
      ) : null}

      {sub === 'emoji' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, marginTop: 8 }}>
          {EMOJIS.map((e) => (
            <Pressable key={e} onPress={() => add({ type: 'emoji', emoji: e })} style={({ pressed }) => [{ width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, pressed && { backgroundColor: fxc.glass }]} accessibilityRole="button" accessibilityLabel={`Emoji ${e}`}>
              <Text style={{ fontSize: 28 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {sub === 'txill' ? <TxillGrid onPick={(id) => add({ type: 'txill', id })} /> : null}
      {sub === 'gif' ? <GifGrid onPick={(g) => add({ type: 'gif', id: g.id, url: g.full, w: g.w, h: g.h })} /> : null}
      {sub === 'mention' ? <MentionPick onPick={(u) => add({ type: 'mention', username: u })} /> : null}
      {sub === 'location' ? <PlacePick onPick={(n) => add({ type: 'location', name: n })} /> : null}
      {sub === 'time' ? (
        <FxRow wrap>
          <FxChip label="Hora" icon={<Icon name="clock" size={14} color="#fff" />} onPress={() => add({ type: 'time', format: 'hora', at: Date.now() })} a11y="Juntar a hora" />
          <FxChip label="Data" icon={<Icon name="calendar" size={14} color="#fff" />} onPress={() => add({ type: 'time', format: 'data', at: Date.now() })} a11y="Juntar a data" />
          <FxChip label="Hora e data" onPress={() => add({ type: 'time', format: 'hora-data', at: Date.now() })} />
        </FxRow>
      ) : null}
    </View>
  );
}

function stickerName(s: StickerContent): string {
  switch (s.type) {
    case 'emoji': return s.emoji;
    case 'mention': return `@${s.username}`;
    case 'location': return s.name;
    case 'time': return s.format === 'data' ? 'Data' : 'Hora';
    case 'gif': return 'GIF';
    case 'txill': return 'Txill';
  }
}

function TxillGrid({ onPick }: { onPick: (id: string) => void }) {
  const [cat, setCat] = useState(STICKER_CATS[0].id);
  const shown = useMemo(() => STICKERS.filter((s) => s.cat === cat).slice(0, 40), [cat]);
  return (
    <>
      <FxRow>
        {STICKER_CATS.map((c) => <FxChip key={c.id} small on={cat === c.id} label={c.label} onPress={() => setCat(c.id)} />)}
      </FxRow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, marginTop: 6 }}>
        {shown.map((s) => (
          <Pressable key={s.id} onPress={() => onPick(s.id)} style={({ pressed }) => [{ width: '20%', height: 76, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }, pressed && { backgroundColor: fxc.glass }]} accessibilityRole="button" accessibilityLabel={`Sticker ${s.text}`}>
            <StickerArt def={s} size={58} animate={false} />
          </Pressable>
        ))}
      </View>
    </>
  );
}

function GifGrid({ onPick }: { onPick: (g: GifItem) => void }) {
  const { enabled } = useGifsConfig();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<GifItem[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let off = false;
    const id = setTimeout(() => {
      setBusy(true);
      (q.trim() ? gifsApi.search(q.trim()) : gifsApi.trending())
        .then((p) => { if (!off) setItems(p.items.slice(0, 24)); })
        .catch(() => { if (!off) setItems([]); })
        .finally(() => { if (!off) setBusy(false); });
    }, 350);
    return () => { off = true; clearTimeout(id); };
  }, [q, enabled]);
  if (!enabled) return <Text style={[ui.note, { marginTop: 12 }]}>Os GIFs não estão ligados neste momento.</Text>;
  return (
    <>
      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Pesquisar no GIPHY" placeholderTextColor="rgba(255,255,255,0.45)" style={inputSt} accessibilityLabel="Pesquisar GIFs" />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, marginTop: 6 }}>
        {items.map((g) => (
          <Pressable key={g.id} onPress={() => onPick(g)} style={{ width: '25%', padding: 3 }} accessibilityRole="button" accessibilityLabel={g.title ? `GIF ${g.title}` : 'GIF'}>
            <View style={{ width: '100%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#1c1c24' }}>
              {dom('img', { src: g.preview, alt: '', loading: 'lazy', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })}
            </View>
          </Pressable>
        ))}
      </View>
      <Text style={[ui.note, { textAlign: 'right' }]}>{busy ? 'A procurar…' : 'Powered by GIPHY'}</Text>
    </>
  );
}

function MentionPick({ onPick }: { onPick: (username: string) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<MentionSuggestion[]>([]);
  const clean = q.replace(/^@/, '').trim();
  useEffect(() => {
    let off = false;
    const id = setTimeout(() => { api.mentionSuggest(clean, 'post').then((r) => { if (!off) setList(r.items.slice(0, 8)); }).catch(() => { if (!off) setList([]); }); }, 180);
    return () => { off = true; clearTimeout(id); };
  }, [clean]);
  const valid = /^[A-Za-z0-9_.]{1,30}$/.test(clean);
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 8 }}>
        <TextInput value={q} onChangeText={(v) => setQ(v.slice(0, 31))} placeholder="@ quem?" placeholderTextColor="rgba(255,255,255,0.45)" autoCapitalize="none" autoCorrect={false} style={[inputSt, { flex: 1 }]} accessibilityLabel="Menção" onSubmitEditing={() => valid && onPick(clean)} />
        <FxAction label="Pôr" tone="coral" onPress={() => onPick(clean)} disabled={!valid} a11y={`Pôr a menção @${clean}`} />
      </View>
      {list.length ? (
        <FxRow>
          {list.map((u) => <FxChip key={u.username} small label={`@${u.username}`} onPress={() => onPick(u.username)} a11y={`Mencionar ${u.displayName}`} />)}
        </FxRow>
      ) : null}
    </>
  );
}

function PlacePick({ onPick }: { onPick: (name: string) => void }) {
  const [q, setQ] = useState('');
  const shown = PLACES.filter((p) => !q.trim() || p.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 8 }}>
        <TextInput value={q} onChangeText={(v) => setQ(v.slice(0, 60))} placeholder="Onde é?" placeholderTextColor="rgba(255,255,255,0.45)" style={[inputSt, { flex: 1 }]} accessibilityLabel="Local" onSubmitEditing={() => q.trim() && onPick(q.trim())} />
        <FxAction label="Pôr" tone="coral" icon={<Icon name="map-pin" size={13} color="#fff" />} onPress={() => onPick(q.trim())} disabled={!q.trim()} a11y={`Pôr o local ${q.trim()}`} />
      </View>
      <FxRow wrap>
        {shown.map((p) => <FxChip key={p} small label={p} onPress={() => onPick(p)} />)}
      </FxRow>
    </>
  );
}

const inputSt = { height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: fxc.line, color: '#fff', paddingHorizontal: 12, fontSize: 14 } as const;
