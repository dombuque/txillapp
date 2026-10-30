import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import Icon from './Icon';

/** Aviso para quem ainda não confirmou o e-mail: sem isso não pode publicar, comentar, conversar nem presentear. */
export default function EmailBanner() {
  const status = useQuery({ queryKey: ['email-status'], queryFn: api.emailStatus, staleTime: 60_000, refetchOnWindowFocus: true });
  const resend = useMutation({ mutationFn: api.resendVerification });
  if (!status.data?.required || status.data.verified) return null;
  return (
    <div role="status" className="mx-4 mb-3 flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-zinc-800">
      <Icon name="mail" size={20} className="mt-0.5 shrink-0 text-amber-700" />
      <p className="min-w-0 flex-1 leading-snug">
        {resend.isSuccess && resend.data.sent ? (
          <>Enviámos um link novo para o teu e-mail. Vê também o spam.</>
        ) : resend.isError ? (
          <>Não consegui reenviar agora. Tenta daqui a pouco.</>
        ) : (
          <>Confirma o teu e-mail para publicar, comentar e conversar. Enviámos-te um link.</>
        )}
      </p>
      {!resend.isSuccess && (
        <button onClick={() => resend.mutate()} disabled={resend.isPending} className="shrink-0 font-bold text-brand underline disabled:opacity-50">
          {resend.isPending ? 'A enviar…' : 'Reenviar'}
        </button>
      )}
    </div>
  );
}
