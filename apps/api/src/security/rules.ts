/**
 * As regras da segurança das contas num só sítio. São propostas: o dono decide os números (ver o relatório da equipa de
 * compliance). Os limites por IP têm de ser largos: em Moçambique as redes móveis (Vodacom, Movitel, Tmcel) põem muita
 * gente atrás do mesmo IP (CGNAT), por isso a defesa principal é por conta, e o IP só trava abusos grandes.
 */
export const LOGIN = {
  /** Janela das falhas (por conta e por IP). */
  WINDOW_MS: 15 * 60_000,
  /** Falhas da mesma conta (o identificador escrito) a partir das quais se pede a prova de humano (se estiver ligada). */
  ACCOUNT_HUMAN_AFTER: 3,
  /** Falhas da mesma conta que a bloqueiam. */
  ACCOUNT_LOCK_AFTER: 5,
  /** O primeiro bloqueio da conta dura isto; cada bloqueio seguinte (em 24 h) dura o dobro, até ao teto. */
  ACCOUNT_LOCK_BASE_MS: 15 * 60_000,
  ACCOUNT_LOCK_MAX_MS: 24 * 3600_000,
  /** Falhas do mesmo IP a partir das quais se pede a prova de humano. */
  IP_HUMAN_AFTER: 10,
  /** Falhas do mesmo IP que o bloqueiam (só no login; o IP pode ter muita gente atrás). */
  IP_LOCK_AFTER: 30,
  IP_LOCK_BASE_MS: 60_000,
  IP_LOCK_MAX_MS: 3600_000,
  /** No máximo um email «Alguém tentou entrar na tua conta» por conta neste intervalo. */
  WARN_EVERY_MS: 6 * 3600_000,
  /** No máximo um email «Novo início de sessão» por conta neste intervalo. */
  NEW_LOGIN_EVERY_MS: 10 * 60_000,
} as const;

export const REGISTER = {
  /** Contas novas por IP numa hora e num dia (com senha, Google ou Apple). */
  PER_IP_HOUR: 5,
  PER_IP_DAY: 20,
  /** Contas novas por rede (/24 no IPv4, /48 no IPv6) num dia. */
  PER_NET_DAY: 60,
  /** Pedidos de «este email já tem conta?» por IP numa hora (o @ é público; o email não). */
  EMAIL_CHECKS_PER_IP_HOUR: 60,
} as const;

export const MAIL_LIMITS = {
  /** Emails de «Esqueci-me da senha» e de «Apagar a conta» para o mesmo endereço numa hora (para não servirem de arma). */
  PER_ADDRESS_HOUR: 3,
} as const;

/** Pontuação de risco (0 a 100) das contas novas. A partir de FLAG a conta vai para a fila e fica limitada LIMIT_HOURS. */
export const RISK = {
  FLAG: 50,
  /** Horas de limites apertados de uma conta marcada (sem mensagens a desconhecidos, poucos «seguir», sem enviar Txills). */
  LIMIT_HOURS: 24,
  /** «Limitar» na fila do backoffice: dias de limites. */
  STAFF_LIMIT_DAYS: 7,
  /** Durante quanto tempo depois do registo se olha para as ações em rajada. */
  WATCH_HOURS: 48,
  /** Contas limitadas: no máximo isto de «seguir» por hora e de pedidos de gelada por dia. */
  LIMITED_FOLLOWS_PER_HOUR: 20,
  LIMITED_GELADAS_PER_DAY: 3,
  /** Os sinais e os pontos (o máximo de cada sinal; a soma é cortada em 100). */
  POINTS: {
    /** Outras contas novas do mesmo IP nas últimas 24 h: 2 → 15, 5 → 30. */
    mesmo_ip: [[2, 15], [5, 30]],
    /** Outras contas novas da mesma rede (/24) nas últimas 24 h: 15 → 10, 40 → 20. Pouco peso: CGNAT. */
    mesma_rede: [[15, 10], [40, 20]],
    /** Outras contas criadas na mesma instalação da app nos últimos 7 dias: 2 → 25, 4 → 40. Várias contas no mesmo aparelho são normais (até 2). */
    mesmo_aparelho: [[2, 25], [4, 40]],
    /** Já há outra conta com o mesmo email «canónico» (nome+qualquercoisa@, pontos no Gmail). */
    mesmo_email: 35,
    /** @ ou nome com cara de gerado (letras e muitos números, sem vogais, nome igual ao @…). */
    nome_gerado: 20,
    /** A prova de humano está ligada e a app não a mandou (versões antigas da app nativa). */
    sem_prova: 10,
    /** Seguiu muita gente numa hora: 40 → 20, 80 → 35. */
    rajada_seguir: [[40, 20], [80, 35]],
    /** Escreveu a muitas pessoas diferentes numa hora: 15 → 20, 30 → 35. */
    rajada_mensagens: [[15, 20], [30, 35]],
    /** A mesma mensagem para 5 pessoas diferentes numa hora. */
    mensagens_iguais: 30,
    /** Muitos pedidos de gelada numa hora: 6 → 15, 12 → 30. */
    rajada_geladas: [[6, 15], [12, 30]],
    /** O mesmo código de convite usado por 5 contas novas numa hora (sinal para quem entra). */
    rajada_convites: 15,
  },
} as const;

/** Bónus de quem passou a prova de humano no registo (tira pontos). */
export const HUMAN_BONUS = 10;

/** Prazo dos eventos de segurança e das impressões de IP, rede, aparelho e email guardadas com a pontuação de risco. */
export const SECURITY_RETENTION_DAYS = 90;
