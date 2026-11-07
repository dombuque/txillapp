import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { markSeen, useIsNew } from '@/lib/whatsNew';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';

interface Point { icon: IconName; title: string; text: string }
interface Intro { icon: IconName; title: string; points: Point[]; note?: string }

/**
 * As boas-vindas a cada função (como o WhatsApp faz ao abrir uma função nova): aparecem uma só vez, na primeira vez que a
 * pessoa a usa. Para acrescentar uma função: uma entrada aqui e `<FeatureIntro id="…" />` no ecrã dela.
 * Guarda-se neste aparelho (a mesma lista das novidades do Início).
 */
export const INTROS: Record<string, Intro> = {
  camera: {
    icon: 'camera',
    title: 'A câmara do Txillapp',
    points: [
      { icon: 'camera', title: 'Toca para foto, mantém para vídeo', text: 'Um botão só. Larga para parar de gravar.' },
      { icon: 'sparkles', title: 'Filtros a deslizar', text: 'Desliza para o lado para trocar de filtro. Pinça para aproximar.' },
      { icon: 'grid', title: 'Layout', text: 'Várias fotos numa só imagem. Depois de tirar, podes editar antes de usar.' },
    ],
  },
  zas: {
    icon: 'bolt',
    title: 'Zás!',
    points: [
      { icon: 'camera', title: 'Foto na hora', text: 'Sem galeria: é o momento, como está. Vai logo, com 6 segundos para desfazer.' },
      { icon: 'clock', title: 'Dura 24 horas', text: 'E cada pessoa só vê uma vez. Depois desaparece.' },
      { icon: 'users', title: 'Só para a malta', text: 'Chega aos amigos próximos e a quem segues e te segue.' },
    ],
    note: 'Vês quem viu e as reações de cada um.',
  },
  mimo: {
    icon: 'sparkles',
    title: 'O teu mimo',
    points: [
      { icon: 'clock', title: 'Dura 24 horas', text: 'Foto ou vídeo com legenda e música, para quem te segue.' },
      { icon: 'heart', title: 'Amigos próximos', text: 'Podes mandar só para a tua lista de amigos próximos.' },
      { icon: 'eye', title: 'Quem viu', text: 'Vês quem viu, quem brindou e as respostas, só tu.' },
    ],
  },
  geleira: {
    icon: 'snowflake',
    title: 'Enche a tua geleira',
    points: [
      { icon: 'search', title: 'Escolhe os teus gostos', text: 'Bebidas, comidas e vibes. Procura e toca para pôr na geleira.' },
      { icon: 'snowflake', title: 'Dá a nota em flocos', text: 'Mais flocos, mais gelado, mais gostas. O coração marca os favoritos.' },
      { icon: 'trending', title: 'Sobe de nível', text: 'Quantidade, variedade e notas dão pontos. A malta vê o teu nível no perfil.' },
    ],
    note: 'As mudanças só vão para o servidor quando carregas em Guardar.',
  },
  supertxill: {
    icon: 'sparkles',
    title: 'SuperTxill',
    points: [
      { icon: 'users', title: 'Malta para ti', text: 'Pessoas com gostos parecidos com os teus, escolhidas pelo Txillapp.' },
      { icon: 'shield', title: 'Só com dados do Txillapp', text: 'Quem segues e a tua geleira. Nada sai para fora.' },
    ],
    note: 'Podes desligar o uso da geleira nas Definições.',
  },
};

/** Monta-se no ecrã da função; só aparece a primeira vez. */
export function FeatureIntro({ id }: { id: string }) {
  const key = `intro:${id}`;
  const fresh = useIsNew(key);
  const intro = INTROS[id];
  if (!fresh || !intro) return null;
  const done = () => markSeen(key);
  return (
    <Sheet onClose={done} plain>
      <View style={st.wrap}>
        <View style={st.hero}>
          <LinearGradient colors={['#d6334f', '#ff9a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'relative' }}><Icon name={intro.icon} size={56} color="#fff" strokeWidth={1.8} /></View>
        </View>
        <Text style={st.title}>{intro.title}</Text>
        <View style={{ gap: 18, marginTop: 20 }}>
          {intro.points.map((p) => (
            <View key={p.title} style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
              <View style={{ width: 28, alignItems: 'center', paddingTop: 2 }}><Icon name={p.icon} size={22} color={colors.zinc700} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.pTitle}>{p.title}</Text>
                <Text style={st.pText}>{p.text}</Text>
              </View>
            </View>
          ))}
        </View>
        {intro.note ? <Text style={st.note}>{intro.note}</Text> : null}
        <Pressable onPress={done} style={({ pressed }) => [st.btn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <Text style={st.btnText}>Continuar</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
  hero: { alignSelf: 'center', width: 120, height: 120, borderRadius: 60, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { textAlign: 'center', fontSize: 26, lineHeight: 31, fontWeight: '800', color: colors.zinc900, letterSpacing: -0.3 },
  pTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900, lineHeight: 21 },
  pText: { fontSize: 15, lineHeight: 20, color: colors.zinc600, marginTop: 1 },
  note: { marginTop: 22, textAlign: 'center', fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  btn: { marginTop: 22, height: 52, borderRadius: 26, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
