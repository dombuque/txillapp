import { useRouter } from 'expo-router';
import { Fragment } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { TERMS_UPDATED, type LegalBlock } from '@/lib/legalText';
import { colors } from '@/lib/theme';
import { StackPage } from './StackPage';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** "2026-10" -> "outubro de 2026". */
const updated = (v: string) => {
  const [y, m] = v.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} de ${y}`;
};

/** Texto com **negrito** e __itálico__. */
function Rich({ text, style }: { text: string; style?: object }) {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.startsWith('**') ? <Text key={i} style={{ fontWeight: '700' }}>{p.slice(2, -2)}</Text>
        : p.startsWith('__') ? <Text key={i} style={{ fontStyle: 'italic' }}>{p.slice(2, -2)}</Text>
        : <Fragment key={i}>{p}</Fragment>,
      )}
    </Text>
  );
}

/** Termos de Uso e Política de Privacidade: a mesma página do site, com o texto em blocos. */
export function LegalPage({ title, sections }: { title: string; sections: LegalBlock[][] }) {
  const router = useRouter();
  return (
    <StackPage title={title}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 64 }}>
        <Text style={st.h1}>{title}</Text>
        <Text style={st.updated}>Última atualização: {updated(TERMS_UPDATED)}</Text>
        <View style={{ marginTop: 24, gap: 24 }}>
          {sections.map((blocks, si) => (
            <View key={si} style={{ gap: 8 }}>
              {blocks.map((b, bi) =>
                b.t === 'h2' ? <Text key={bi} style={st.h2}>{b.x}</Text>
                : b.t === 'h3' ? <Text key={bi} style={st.h3}>{b.x}</Text>
                : b.t === 'p' ? <Rich key={bi} text={b.x} style={st.p} />
                : b.t !== 'ul' ? null
                : (
                  <View key={bi} style={{ gap: 4 }}>
                    {b.x.map((li, i) => (
                      <View key={i} style={{ flexDirection: 'row', gap: 8, paddingLeft: 8 }}>
                        <Text style={st.p}>{'•'}</Text>
                        <Rich text={li} style={[st.p, { flex: 1 }]} />
                      </View>
                    ))}
                  </View>
                ),
              )}
            </View>
          ))}
        </View>
        <Text style={st.foot}>
          <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.replace('/terms' as never)}>Termos de Uso</Text>
          {' · '}
          <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.replace('/privacy' as never)}>Política de Privacidade</Text>
        </Text>
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  h1: { marginTop: 24, fontSize: 30, fontWeight: '800', color: colors.zinc900 },
  updated: { marginTop: 4, fontSize: 14, color: colors.zinc500 },
  h2: { fontSize: 20, fontWeight: '700', color: colors.zinc800 },
  h3: { marginTop: 4, fontSize: 17, fontWeight: '700', color: colors.zinc800 },
  p: { fontSize: 16, lineHeight: 26, color: colors.zinc800 },
  foot: { marginTop: 40, textAlign: 'center', fontSize: 14, color: colors.zinc500 },
});
