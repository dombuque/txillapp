import { raw, post } from './api';

/** Chamadas dos links que chegam por email (confirmar conta e repor a senha): não exigem sessão. */
export const emailApi = {
  verifyEmail: (token: string): Promise<{ ok: boolean }> => raw('/auth/email/verify', post({ token })),
  resetPassword: (token: string, newPassword: string): Promise<{ ok: boolean }> => raw('/auth/password/reset', post({ token, newPassword })),
};
