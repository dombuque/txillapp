import Constants from 'expo-constants';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Group, Line } from '@/components/Lines';
import { StackPage } from '@/components/StackPage';
import { colors } from '@/lib/theme';

const SUPPORT = 'suporte@txillapp.com';

const FAQ: { q: string; a: string }[] = [
  { q: 'O que são os Txills?', a: 'São a moeda de brincadeira do Txillapp. Servem para presentear quem segues e agradecer um bom post. Por agora são uma demonstração: não valem dinheiro.' },
  { q: 'Como funcionam os brindes?', a: 'Tocas em "Brindar" num post ou Tcheka para mostrar que gostaste. É grátis e a pessoa é avisada.' },
  { q: 'Como presenteio alguém?', a: 'Só podes presentear quem segues. Abre o perfil ou o post e toca em "Presentear". Podes deixar o presente em silêncio, privado ou publicá-lo para toda a gente ver.' },
  { q: 'O que é a geleira?', a: 'A tua vitrine de gostos: vibes, bebidas, comidas e sítios. Edita-a em Editar perfil. Quanto mais paulada tiveres lá, mais sobe de nível.' },
  { q: 'O que é a visualização única?', a: 'Fotos, voz e mensagens que só se abrem uma vez e depois desaparecem do chat.' },
  { q: 'Como bloqueio ou denuncio alguém?', a: 'No perfil, toca nos três pontos e escolhe Bloquear. Para denunciar um post, comentário ou conversa, usa o menu dele e escolhe Denunciar. A moderação vê o pedido.' },
  { q: 'Como pedir o selo de verificado?', a: 'Em Definições, Verificação. A conta tem de cumprir alguns requisitos e depois enviamos o pedido com um documento e uma selfie, que a moderação revê. Os documentos são apagados quando há decisão.' },
  { q: 'Quem vê quando estou online?', a: 'Só quem também mostra a presença. Em Definições, "Mostrar quando estou online" desliga isso (e também deixas de ver os outros).' },
  { q: 'Como mudo a privacidade da conta?', a: 'Em Definições, Privacidade da conta: perfil público ou privado, quem comenta, quem te menciona e quem te envia mensagens.' },
  { q: 'Esqueci-me da senha. E agora?', a: 'No ecrã de entrada, toca em "Esqueci-me da senha". Enviamos-te um email para criares uma nova.' },
  { q: 'Como elimino a minha conta?', a: 'Em Definições, Conta, "Eliminar conta". Podes descarregar os teus dados antes, na mesma secção.' },
];

/** Ajuda: perguntas frequentes e contacto (igual à do site). */
export default function Help() {
  const [open, setOpen] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const list = FAQ.filter((f) => !term.trim() || `${f.q} ${f.a}`.toLowerCase().includes(term.trim().toLowerCase()));
  const subject = encodeURIComponent('Problema no Txillapp');
  const body = encodeURIComponent(`\n\n---\nVersão: ${Constants.expoConfig?.version ?? ''}\nAparelho: ${Platform.OS} ${Platform.Version}`);
  return (
    <StackPage title="Ajuda">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View style={st.search}>
            <Icon name="search" size={18} color={colors.zinc500} />
            <TextInput value={term} onChangeText={setTerm} placeholder="Procurar na ajuda" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar na ajuda" style={st.input} />
          </View>
        </View>
        <Group title="Perguntas frequentes">
          {list.length === 0 ? <Text style={st.none}>Nada com essa palavra. Fala connosco, em baixo.</Text> : null}
          {list.map((f, i) => (
            <View key={f.q}>
              <Pressable onPress={() => setOpen(open === i ? null : i)} accessibilityRole="button" accessibilityState={{ expanded: open === i }} style={({ pressed }) => [st.q, pressed && { backgroundColor: '#fafafa' }]}>
                <Text style={st.qText}>{f.q}</Text>
                <View style={{ transform: [{ rotate: open === i ? '90deg' : '0deg' }] }}><Icon name="chevron-right" size={18} color="#a1a1aa" /></View>
              </Pressable>
              {open === i ? <Text style={st.a}>{f.a}</Text> : null}
            </View>
          ))}
        </Group>
        <Group title="Fala connosco">
          <Line icon="mail" label="Contactar o suporte" value={SUPPORT} href={`mailto:${SUPPORT}`} />
          <Line icon="alert" label="Reportar um problema" value="Já leva a versão e o aparelho" href={`mailto:${SUPPORT}?subject=${subject}&body=${body}`} />
          <Line icon="shield" label="Segurança e privacidade" to="/privacy" />
        </Group>
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  search: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 16 },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' as never },
  none: { paddingHorizontal: 16, paddingVertical: 24, textAlign: 'center', color: colors.zinc500, fontSize: 16 },
  q: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  qText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  a: { paddingHorizontal: 16, paddingBottom: 16, fontSize: 15, lineHeight: 21, color: colors.zinc700 },
});
