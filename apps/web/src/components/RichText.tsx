import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Mesmas regras do servidor: o @ ou # não pode vir colado a letras (e-mails, endereços) e o ponto final não faz parte do nome.
const TOKEN = /(?<![\p{L}\p{N}_.&#])(?:@([a-zA-Z0-9_.]{3,30})|#([\p{L}\p{N}_]{2,30}))/gu;
const plain = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Texto com @menções e #hashtags clicáveis (abrem o perfil ou a página da hashtag). */
export default function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index!;
    if (start > last) out.push(text.slice(last, start));
    if (m[1]) {
      const name = m[1].replace(/\.+$/, '');
      out.push(
        <Link key={start} to={`/u/${name}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-brand">
          @{name}
        </Link>,
      );
      last = start + 1 + name.length;
    } else {
      const tag = m[2];
      out.push(
        <Link key={start} to={`/tag/${plain(tag)}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-brand">
          #{tag}
        </Link>,
      );
      last = start + 1 + tag.length;
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
