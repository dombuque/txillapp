import { raw, post } from './api';

/** Chamadas dos links que chegam por email (confirmar conta, repor a senha e apagar a conta): não exigem sessão. */
export const emailApi = {
  verifyEmail: (token: string): Promise<{ ok: boolean }> => raw('/auth/email/verify', post({ token })),
  resetPassword: (token: string, newPassword: string): Promise<{ ok: boolean }> => raw('/auth/password/reset', post({ token, newPassword })),
  /** txillapp.com/apagar-conta: manda a ligação de confirmação para o email da conta (responde igual, haja conta ou não). */
  requestDeletion: (email: string): Promise<{ ok: boolean; mail: boolean }> => raw('/auth/delete-account/request', post({ email })),
  deletionPreview: (token: string): Promise<{ username: string; displayName: string }> => raw('/auth/delete-account/preview', post({ token })),
  confirmDeletion: (token: string): Promise<void> => raw('/auth/delete-account/confirm', post({ token })),
};
