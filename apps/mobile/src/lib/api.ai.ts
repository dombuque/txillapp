import { post, raw } from '@/lib/api';

/** Pessoa sugerida pelo SuperTxill (o mesmo formato das sugestões, sem os amigos em comum). */
export interface AiSuggestion {
  username: string;
  displayName: string;
  isPrivate: boolean;
  requested: boolean;
  followsYou: boolean;
  reason: string;
}
export interface AiMessage { id: string; role: 'user' | 'assistant'; body: string; at: string }
export interface AiThread { messages: AiMessage[]; pending: boolean; enabled: boolean }

/** O SuperTxill: pessoas para ti, e a conversa (perguntar, histórico, apagar). */
export const aiApi = {
  forYou: (): Promise<AiSuggestion[]> => raw('/supertxill/for-you'),
  thread: (): Promise<AiThread> => raw('/supertxill'),
  ask: (text: string): Promise<{ id: string }> => raw('/supertxill/ask', post({ text })),
  clear: (): Promise<void> => raw('/supertxill/clear', post({})),
};
