import { LegalPage } from '@/components/LegalPage';
import { PRIVACY } from '@/lib/legalText';
import { t } from '@/lib/i18n';

/** Política de Privacidade (igual a /privacy no site). */
export default function Privacy() {
  return <LegalPage title={t('Política de Privacidade')} sections={PRIVACY} />;
}
