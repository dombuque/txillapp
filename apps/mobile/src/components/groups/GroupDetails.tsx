import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { uploadMedia } from '@/lib/api';
import { groupKindOf, groupsApi, type GroupKind, type TxillGroupInfo } from '@/lib/api.groups';
import { abs } from '@/lib/config';
import { colors } from '@/lib/theme';
import { ErrText, Field, KindChips, Pill } from './GroupParts';

/** A capa é a foto larga do grupo; a foto de perfil é a redonda (lista de conversas, cabeçalho, mapa). */
export interface GroupDraft { name: string; kind: GroupKind; description: string; coverUri: string | null; coverMediaId: string | null; avatarUri: string | null; avatarMediaId: string | null }
export const emptyDraft = (): GroupDraft => ({ name: '', kind: 'festa', description: '', coverUri: null, coverMediaId: null, avatarUri: null, avatarMediaId: null });

/** Escolhe uma foto na galeria e envia-a logo (pública: aparece na lista, no cabeçalho e no mapa). Serve para a capa e para a foto de perfil. */
async function pickImage(): Promise<{ uri: string; mediaId: string } | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  const mediaId = await uploadMedia(a.uri, a.mimeType ?? 'image/jpeg', 'public');
  return { uri: a.uri, mediaId };
}

/** Os dados do TxillGroup: nome (obrigatório), tipo, descrição, capa e foto de perfil. Serve para criar e para editar. */
export function GroupDetailsForm({ draft, onChange }: { draft: GroupDraft; onChange: (d: GroupDraft) => void }) {
  const [uploading, setUploading] = useState<'cover' | 'avatar' | null>(null);
  const [err, setErr] = useState('');
  async function pick(which: 'cover' | 'avatar') {
    setErr('');
    setUploading(which);
    try {
      const c = await pickImage();
      if (c) onChange(which === 'cover' ? { ...draft, coverUri: c.uri, coverMediaId: c.mediaId } : { ...draft, avatarUri: c.uri, avatarMediaId: c.mediaId });
    } catch (e) {
      setErr((e as Error).message || (which === 'cover' ? 'Não consegui enviar a capa.' : 'Não consegui enviar a foto.'));
    } finally {
      setUploading(null);
    }
  }
  const busy = uploading !== null;
  return (
    <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 14 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => void pick('cover')} disabled={busy} style={st.cover} accessibilityRole="button" accessibilityLabel={draft.coverUri ? 'Mudar a capa' : 'Pôr uma capa'}>
            {draft.coverUri ? <Image source={{ uri: draft.coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="camera" size={26} color={colors.zinc500} />}
            {uploading === 'cover' && <View style={st.coverBusy}><Text style={st.busyText}>A enviar…</Text></View>}
          </Pressable>
          <Text style={st.picLabel}>Capa</Text>
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => void pick('avatar')} disabled={busy} style={st.avatar} accessibilityRole="button" accessibilityLabel={draft.avatarUri ? 'Mudar a foto de perfil do grupo' : 'Pôr uma foto de perfil do grupo'}>
            {draft.avatarUri ? <Image source={{ uri: draft.avatarUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="image" size={24} color={colors.zinc500} />}
            {uploading === 'avatar' && <View style={st.coverBusy}><Text style={st.busyText}>A enviar…</Text></View>}
          </Pressable>
          <Text style={st.picLabel}>Foto</Text>
        </View>
        <Text style={[st.hint, { flex: 1 }]}>{draft.coverUri || draft.avatarUri ? 'Toca na capa ou na foto para trocar.' : 'Capa e foto de perfil opcionais. Toca para escolher.'}</Text>
      </View>
      <Field value={draft.name} onChangeText={(name) => onChange({ ...draft, name })} maxLength={40} autoFocus placeholder="Nome · ex.: Fim de ano no Tofo" accessibilityLabel="Nome do TxillGroup" />
      <View style={{ gap: 8 }}>
        <Text style={st.label}>Que tipo de TxillGroup?</Text>
        <KindChips value={draft.kind} onChange={(kind) => onChange({ ...draft, kind })} />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={st.label}>Descrição <Text style={{ fontWeight: '500', color: colors.zinc500 }}>(opcional)</Text></Text>
        <Field value={draft.description} onChangeText={(description) => onChange({ ...draft, description })} maxLength={300} multiline placeholder="O que se vai passar, regras da malta, o que levar…" accessibilityLabel="Descrição" />
      </View>
      <ErrText text={err} />
    </ScrollView>
  );
}

export const draftError = (d: GroupDraft) => (d.name.trim().length < 2 ? 'O nome precisa de pelo menos 2 letras.' : '');

/** Editar o TxillGroup (só administradores). */
export function GroupEditSheet({ group, onClose, onSaved }: { group: TxillGroupInfo; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<GroupDraft>({
    name: group.name,
    kind: groupKindOf(group) ?? 'outro',
    description: group.description ?? '',
    coverUri: abs(group.coverUrl) ?? null,
    coverMediaId: null,
    avatarUri: abs(group.avatarUrl) ?? null,
    avatarMediaId: null,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    const bad = draftError(draft);
    if (bad) return setErr(bad);
    setBusy(true);
    setErr('');
    try {
      await groupsApi.update(group.id, {
        name: draft.name.trim(),
        kind: draft.kind,
        description: draft.description.trim() || null,
        ...(draft.coverMediaId ? { coverMediaId: draft.coverMediaId } : null),
        ...(draft.avatarMediaId ? { avatarMediaId: draft.avatarMediaId } : null),
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Sheet title="Editar TxillGroup" onClose={onClose}>
      <GroupDetailsForm draft={draft} onChange={setDraft} />
      <View style={{ paddingHorizontal: 20 }}>
        <ErrText text={err} />
        <Pill label="Guardar" busy={busy} onPress={() => void save()} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  cover: { width: 84, height: 84, borderRadius: 24, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverBusy: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  busyText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  picLabel: { fontSize: 12, fontWeight: '600', color: colors.zinc600 },
  hint: { paddingHorizontal: 4, fontSize: 12, color: colors.zinc500 },
  label: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
});
