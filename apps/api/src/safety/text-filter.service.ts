import { Injectable, UnprocessableEntityException } from '@nestjs/common';

export type Violation = 'threat' | 'self-harm' | 'hate';

/**
 * Filtro de texto para o que as pessoas escrevem (publicações, comentários, mensagens, notas, legendas, perfil…).
 * Recusa o que é claramente abusivo: ameaças de morte ou violência sexual, incentivo ao suicídio e insultos de ódio (racistas,
 * homofóbicos, etc.). Não é um filtro de palavrões: o calão e as brincadeiras da malta passam. É deliberadamente conservador
 * para não apanhar frases normais ("matar a fome", "morri de rir"), e junta-se às denúncias e à moderação, não as substitui.
 *
 * O texto é normalizado antes de comparar: minúsculas, sem acentos, "números por letras" (m4t4r), sem letras repetidas e sem
 * pontuação a separar letras (m.a.t.a.r).
 */

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Minúsculas, sem acentos, leet → letras, só letras e espaços, sem repetições seguidas. */
export function normalize(text: string): string {
  const base = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]+/g, ' ');
  return base.replace(/(.)\1+/g, '$1').replace(/\s+/g, ' ').trim();
}

const VERBS_PT = 'matar|esfaquear|violar|espancar|queimar|enforcar';

/** Frases com limites de palavra (comparadas no texto normalizado, com espaços). */
const PHRASES: { kind: Violation; re: RegExp }[] = [
  // Ameaças de morte e de violência (português)
  { kind: 'threat', re: new RegExp(`\\bvou (te (${VERBS_PT})|(${VERBS_PT}) te)\\b`) },
  { kind: 'threat', re: /\bvou te (dar um tiro|partir (a|toda a) cara|cortar o pescoco)\b/ },
  { kind: 'threat', re: /\b(mato|esfaqueio|violo|espanco) te\b/ },
  { kind: 'threat', re: /\bvais (levar|apanhar) um tiro\b/ },
  // Ameaças (inglês; o texto normalizado não tem letras repetidas: "kill" vira "kil")
  { kind: 'threat', re: /\bi (will|wil|ll|am going to|m going to|am gonna|m gona|gona|gonna) (kil|rape|shot|shoot|stab|murder) (you|u|ya)\b/ },
  { kind: 'threat', re: /\b(ill|i ll|i wil) (kil|rape|stab|murder) (you|u)\b/ },
  // Incentivo ao suicídio
  { kind: 'self-harm', re: /\b(mata te|suicida te|enforca te|corta os pulsos)\b(?! (de|a) (rir|correr|trabalhar|estudar|comer|dancar))/ },
  { kind: 'self-harm', re: /\b(go )?kil (your ?self|urself|ur ?self)\b/ },
  { kind: 'self-harm', re: /\bkys\b/ },
  { kind: 'self-harm', re: /\b(go )?(hang|cut) (your ?self|urself)\b/ },
  // Insultos de ódio (frases com o grupo visado)
  { kind: 'hate', re: /\b(preto|preta|negro|negra|macaco|macaca) (de merda|nojent[oa]|imund[oa]|sujo|suja)\b/ },
  { kind: 'hate', re: /\b(bicha|viado|maricas|paneleiro|sapatao|sapatona|travesti) (de merda|nojent[oa]|imund[oa])\b/ },
  { kind: 'hate', re: /\b(mata|matem|matar|morte (a|aos|as|ao)) (os |as |todos os |todas as )?(pretos|negros|brancos|gays|bichas|viados|muculmanos|judeus|indianos|chineses|albinos)\b/ },
  { kind: 'hate', re: /\b(todos os|todas as) (pretos|negros|gays|viados|bichas|judeus|muculmanos) (devem|tem de|merecem) (morrer|apodrecer)\b/ },
];

/** Palavras de ódio sem ambiguidade (inglês e português), como palavras inteiras no texto normalizado. */
const SLURS = ['niger', 'niga', 'nigers', 'nigas', 'fagot', 'fagots', 'fag', 'kike', 'chink', 'spic', 'wetback', 'tranny', 'trany', 'coon', 'gook', 'sandniger', 'paki', 'negrata', 'crioulo de merda', 'preto imundo'];
const SLUR_RE = new RegExp(`\\b(${SLURS.join('|')})\\b`);

/** Versão sem espaços, só para as frases mais longas e sem ambiguidade (apanha "m a t a r", "v.o.u.t.e.m.a.t.a.r"). */
const COMPACT: { kind: Violation; part: string }[] = [
  { kind: 'threat', part: 'voutematar' },
  { kind: 'threat', part: 'voumatarte' },
  { kind: 'threat', part: 'ikilyou' },
  { kind: 'self-harm', part: 'kilyourself' },
  { kind: 'self-harm', part: 'kilurself' },
];

@Injectable()
export class TextFilter {
  /** Devolve o tipo de problema, ou null se o texto está bem. */
  check(text: string | null | undefined): Violation | null {
    if (!text) return null;
    const n = normalize(text);
    if (!n) return null;
    for (const p of PHRASES) if (p.re.test(n)) return p.kind;
    if (SLUR_RE.test(n)) return 'hate';
    const compact = n.replace(/ /g, '');
    for (const c of COMPACT) if (compact.includes(c.part)) return c.kind;
    return null;
  }

  /** Lança 422 se algum dos textos for abusivo. Aceita vários campos de uma vez. */
  assertClean(...texts: (string | null | undefined)[]): void {
    for (const t of texts) {
      const v = this.check(t);
      if (v) {
        throw new UnprocessableEntityException(
          v === 'self-harm'
            ? 'Isto incentiva a pessoa a magoar-se. Na malta cuidamos uns dos outros'
            : v === 'hate'
              ? 'Isto tem ódio ou insultos a um grupo de pessoas. Aqui não'
              : 'Isto parece uma ameaça. Aqui não se ameaça ninguém',
        );
      }
    }
  }
}
