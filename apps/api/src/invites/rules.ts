import { createHash, randomInt } from 'node:crypto';
import { isDisposableEmail } from '../security/disposable';

/** As regras dos convites num só sítio. Valores propostos e aprovados: ver a conversa de 4 de novembro de 2026. */
export const INVITE = {
  /** Txills para quem entra e para quem convida (cada um). */
  REWARD: 50,
  /** Convites premiados por pessoa e por dia. */
  PER_DAY: 5,
  /** Convites premiados por pessoa, no total (50 × 100 = 5000 Txills). Depois disto o convite funciona, mas sem prémio. */
  MAX_PAID: 50,
  /** O prémio de quem convida fica em espera estes dias. */
  HOLD_DAYS: 7,
  /** Só convida quem tem a conta com mais de N dias (e o email confirmado). */
  MIN_AGE_DAYS: 3,
  /** Teto mensal de Txills emitidos em convites (para o sistema nunca fugir ao controlo). */
  MONTHLY_BUDGET: 500_000,
  /** Registos da mesma rede, por quem convida, em 24 h, a partir dos quais deixam de ser premiados. */
  SAME_NET_MAX: 3,
  /** Para ficar «ativa»: publicou algo ou segue pelo menos N pessoas. */
  ACTIVE_FOLLOWS: 3,
  /**
   * Conta real (desde a 0149): além do email confirmado e da atividade, voltou ao Txillapp pelo menos N horas depois do
   * registo (uma sessão nova ou renovada nessa altura) e não está marcada como suspeita. Só então há prémio para alguém.
   */
  RETURN_HOURS: 12,
  /** Contas novas com o mesmo código numa hora a partir das quais cada uma leva pontos de risco («rajada de convites»). */
  BURST_PER_HOUR: 5,
} as const;

/** Domínios de email temporário (não dão prémio; desde a 0149 também não registam). A lista é a da segurança. */
export const isDisposable = (email: string) => isDisposableEmail(email);

/** Impressão da rede (não guarda o IP): só serve para ver se muitos registos vêm do mesmo sítio. */
export const hashNet = (ip: string, salt: string) => createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32);

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
