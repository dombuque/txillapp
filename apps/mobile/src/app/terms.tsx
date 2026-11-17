import { LegalPage } from '@/components/LegalPage';
import { TERMS } from '@/lib/legalText';
import { t } from '@/lib/i18n';

/** Termos de Uso (igual a /terms no site). */
export default function Terms() {
  return <LegalPage title={t('Termos de Uso')} sections={TERMS} />;
}
