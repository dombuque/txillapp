import { Fragment, type ReactNode } from 'react';

/** O que se põe no lugar de um marcador: recebe o texto de dentro (vazio em `<nome/>`). */
export type TransTag = (inner: string) => ReactNode;

/** `<nome>…</nome>` ou `<nome/>`; os nomes são só letras minúsculas, números e «-». */
const TAG = /<([a-z][\w-]*)>([\s\S]*?)<\/\1>|<([a-z][\w-]*)\s*\/>/g;

/**
 * Parte uma frase já traduzida nos seus pedaços: o texto normal fica texto e cada marcador passa pela função com o
 * mesmo nome em `tags`. Um marcador sem função fica só com o texto de dentro (nunca aparece «<b>» na app).
 */
export function transParts(text: string, tags: Record<string, TransTag>): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TAG)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const name = m[1] ?? m[3];
    const inner = m[2] ?? '';
    const fn = tags[name];
    out.push(<Fragment key={`t${k++}`}>{fn ? fn(inner) : inner}</Fragment>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Uma frase traduzida com partes com estilo (negrito, ligações, um selo no meio), sem a partir em pedaços: a ordem das
 * palavras muda de idioma para idioma, por isso a frase vai inteira ao tradutor, com marcadores.
 *
 *   <Text style={st.p}>
 *     <T text={t('Vais apagar a conta <b>@{username}</b> e os teus dados.', { username })} tags={{ b: (s) => <Text style={st.bold}>{s}</Text> }} />
 *   </Text>
 *
 * Fica dentro de um <Text>, como texto normal. O tradutor (scripts/i18n/translate.mjs) protege os marcadores.
 */
export function T({ text, tags }: { text: string; tags: Record<string, TransTag> }) {
  return <>{transParts(text, tags)}</>;
}
