/**
 * O Txillapp percebe quando alguém pede para pagares ("paga-me uma cerveja", "tás a dever") e sugere presentear com Txills.
 * A leitura é feita no próprio aparelho; nada é enviado a lado nenhum. (Mesmas regras do site.)
 */
export interface Intent {
  title: string;
  hint: string;
  amount: number;
  note: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const DRINK = /\b(cerveja|cerva|bejita|bejas?|laurentina|2m|manica|txilar|bebida|copo|shot|rodada|saideira|whisky|vinho|gin)\b/;
const FOOD = /\b(jantar|almoco|lanche|pizza|matapa|gelado|prato|pao|hamburguer|comida|cafe|pequeno almoco|marisco|camarao|bifana)\b/;
const ASK_PAY = /\b(paga|pagas|pagar|paga-?me|pagas-?me|tas a dever|estas a dever|deves|devo-?te|fica por tua conta|por tua conta|quem paga|vais pagar|e tu que pagas)\b/;

export function detectPaymentAsk(text: string, name: string): Intent | null {
  const t = fold(text);
  if (!ASK_PAY.test(t)) return null;
  const drink = DRINK.test(t);
  const food = FOOD.test(t);
  const what = drink ? 'uma bebida' : food ? 'uma refeição' : '';
  return {
    title: drink || food ? `${name} pediu ${what}` : `${name} pediu para pagares`,
    hint: 'Presenteia com Txills e resolve já aqui.',
    amount: food ? 50 : 10,
    note: drink ? 'Uma bebida por minha conta' : food ? 'Esta refeição é por minha conta' : 'Por minha conta',
  };
}
