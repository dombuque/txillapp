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

export const registerSchema = z.object({
  email: z.string().email().max(254),
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(60),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254),
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
