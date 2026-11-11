/** No browser as permissões pedem-se quando são precisas (e as notificações têm o seu aviso): nada a fazer aqui. */
export function PermissionsOnboarding() {
  return null;
}

/** Na web não há passo a passo das permissões: conta como feito. */
export const permissionsOnboardingDone = async (): Promise<boolean> => true;
