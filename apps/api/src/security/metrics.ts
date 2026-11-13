import client from 'prom-client';
import { registry } from '../observability/metrics';

/**
 * Métricas da segurança para o Prometheus (o mesmo /api/v1/metrics). No Grafana, um ataque vê-se assim:
 *   sum by (kind) (rate(txill_security_events_total[5m]))            eventos por tipo (falhas, bloqueios, Turnstile…)
 *   sum by (result) (rate(txill_auth_login_total[5m]))               logins certos e errados
 *   txill_argon2_waiting                                             fila de hashes à espera (CPU)
 */
const once = <T>(name: string, make: () => T): T => (registry.getSingleMetric(name) as T | undefined) ?? make();

export const securityEvents = once('txill_security_events_total', () => new client.Counter({
  name: 'txill_security_events_total',
  help: 'Eventos de segurança (login falhado, bloqueios, prova de humano, registos travados, contas suspeitas, sessão reutilizada)',
  labelNames: ['kind'] as const,
  registers: [registry],
}));

export const loginResults = once('txill_auth_login_total', () => new client.Counter({
  name: 'txill_auth_login_total',
  help: 'Tentativas de login com senha, pelo resultado',
  labelNames: ['result'] as const,
  registers: [registry],
}));

export const registerResults = once('txill_auth_register_total', () => new client.Counter({
  name: 'txill_auth_register_total',
  help: 'Tentativas de registo, pelo resultado',
  labelNames: ['result'] as const,
  registers: [registry],
}));

export const argonInFlight = once('txill_argon2_in_flight', () => new client.Gauge({
  name: 'txill_argon2_in_flight', help: 'Hashes argon2 a correr agora', registers: [registry],
}));

export const argonWaiting = once('txill_argon2_waiting', () => new client.Gauge({
  name: 'txill_argon2_waiting', help: 'Hashes argon2 à espera de vez', registers: [registry],
}));

export const argonRejected = once('txill_argon2_rejected_total', () => new client.Counter({
  name: 'txill_argon2_rejected_total', help: 'Pedidos recusados porque a fila de hashes estava cheia ou demorou demasiado', registers: [registry],
}));

export const riskFlagged = once('txill_risk_flagged_total', () => new client.Counter({
  name: 'txill_risk_flagged_total', help: 'Contas novas marcadas como suspeitas', registers: [registry],
}));
