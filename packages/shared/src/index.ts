import { z } from 'zod';

export const usernameSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_.]+$/, 'Apenas letras, números, "_" e "."');

export const passwordSchema = z
  .string()
  .min(10, 'Mínimo de 10 caracteres')
  .max(128);

/** Género definido pela própria pessoa. "unspecified" = prefere não dizer (continua a ser uma escolha). */
export const genderSchema = z.enum(['female', 'male', 'other', 'unspecified']);
export type Gender = z.infer<typeof genderSchema>;

/** Idade mínima para ter conta. */
export const MIN_AGE = 13;
/** Versão em vigor dos Termos e da Política de Privacidade (muda quando o texto muda). */
export const TERMS_VERSION = '2026-10';

/** Idade completa em `on` (por omissão, hoje) de alguém nascido em `birthDate` (AAAA-MM-DD). */
export function ageOf(birthDate: string, on: Date = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = on.getUTCFullYear() - y;
  if (on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d)) age -= 1;
  return age;
}

export const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((v) => {
    const dt = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === v && dt <= new Date();
  }, 'Data inválida')
  .refine((v) => ageOf(v) >= MIN_AGE, `Tens de ter pelo menos ${MIN_AGE} anos para criar conta`)
  .refine((v) => ageOf(v) <= 120, 'Data inválida');

export const registerSchema = z.object({
  birthDate: birthDateSchema,
  /** Aceitar os Termos e a Política de Privacidade. */
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Tens de aceitar os Termos e a Política de Privacidade' }) }),
  /** Pedido no registo. O servidor aceita a falta (contas antigas, API), mas a app não deixa continuar sem escolher. */
  gender: genderSchema.optional(),
  email: z.string().email().max(254),
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(60),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  /** Nome de utilizador ou email. */
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
}

export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}
