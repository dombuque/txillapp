import type { ChatMessage } from './api';

/**
 * O chat percebe do que se está a falar e sugere presentear no momento certo ("paga-me uma cerveja", "parabéns", "eu pago").
 * A leitura é feita no próprio aparelho, só sobre as últimas mensagens de texto desta conversa: nada é enviado a lado nenhum.
 */
export interface Intent {
  /** A mensagem que deu a pista (para a sugestão não voltar depois de dispensada). */
  key: string;
  title: string;
  hint: string;
  amount: number;
  note: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const DRINK = /\b(cerveja|cerva|bejita|bejas?|laurentina|2m|manica|txilar|bebida|copo|shot|rodada|saideira|whisky|vinho|gin)\b/;
const FOOD = /\b(jantar|almoco|lanche|pizza|matapa|gelado|prato|pao|hamburguer|comida|cafe|pequeno almoco|marisco|camarao|bifana)\b/;
const ASK_PAY = /\b(paga|pagas|pagar|paga-?me|pagas-?me|tas a dever|estas a dever|deves|devo-?te|fica por tua conta|por tua conta|quem paga|vais pagar|e tu que pagas)\b/;
const I_PAY = /\b(eu pago|pago eu|deixa que eu pago|vou pagar|fica por minha conta|por minha conta|esta por minha conta|e por minha conta|ofereco)\b/;
const THANKS_PAID = /\b(obrigad[oa] (pela|pelo|por)|valeu (pela|pelo)|ja pagaste|pagaste)\b/;
const BIRTHDAY = /\b(parabens|feliz aniversario|feliz anivers|aniversario|faz anos|e o meu aniversario)\b/;

/** Alguém pede para pagares ("paga-me uma cerveja", "tás a dever")? Usado nos comentários, com a mesma leitura do chat. */
export function detectPaymentAsk(text: string, name: string): Intent | null {
  const t = fold(text);
  if (!ASK_PAY.test(t)) return null;
  const drink = DRINK.test(t);
  const food = FOOD.test(t);
  const what = drink ? 'uma bebida' : food ? 'uma refeição' : '';
  return {
    key: t,
    title: drink || food ? `${name} pediu ${what}` : `${name} pediu para pagares`,
    hint: 'Presenteia com Txills e resolve já aqui.',
    amount: food ? 50 : 10,
    note: drink ? 'Uma bebida por minha conta' : food ? 'Esta refeição é por minha conta' : 'Por minha conta',
  };
}

/** Procura nas últimas mensagens de texto (até 15 min) uma ocasião para presentear. `name` é o primeiro nome da outra pessoa. */
export function detectIntent(messages: Pick<ChatMessage, 'id' | 'fromMe' | 'body' | 'kind' | 'at'>[], name: string): Intent | null {
  const now = Date.now();
  const recent = messages
    .filter((m) => (m.kind === 'text' || m.kind === 'sticker') && now - new Date(m.at).getTime() < 15 * 60_000)
    .slice(-4);
  for (const m of [...recent].reverse()) {
    const t = m.kind === 'sticker' ? (m.body === 'paga' ? 'paga uma cerveja' : m.body === 'parabens' ? 'parabens' : '') : fold(m.body);
    if (!t) continue;
    const drink = DRINK.test(t);
    const food = FOOD.test(t);
    const what = drink ? 'uma bebida' : food ? 'uma refeição' : '';
    if (!m.fromMe && ASK_PAY.test(t)) {
      return {
        key: m.id,
        title: drink || food ? `${name} pediu ${what}` : `${name} pediu para pagares`,
        hint: 'Presenteia com Txills e resolve já aqui, sem sair da conversa.',
        amount: food ? 50 : 10,
        note: drink ? 'Uma bebida por minha conta' : food ? 'Esta refeição é por minha conta' : 'Por minha conta',
      };
    }
    if (m.fromMe && I_PAY.test(t)) {
      return {
        key: m.id,
        title: 'Disseste que pagavas',
        hint: `Cumpre a promessa: manda Txills a ${name} agora.`,
        amount: food ? 50 : 10,
        note: drink ? 'Prometido é devido: a bebida é minha' : 'Prometido é devido',
      };
    }
    if (BIRTHDAY.test(t) && !THANKS_PAID.test(t)) {
      return {
        key: m.id,
        title: m.fromMe ? `Dar os parabéns a ${name}?` : 'Fala-se de aniversário',
        hint: `Acompanha os parabéns com um presente para ${name}.`,
        amount: 50,
        note: 'Parabéns! Aproveita o teu dia',
      };
    }
  }
  return null;
}
