import { LegalPage } from '@/components/LegalPage';
import { PRIVACY } from '@/lib/legalText';

/** Política de Privacidade (igual a /privacy no site). */
export default function Privacy() {
  return <LegalPage title="Política de Privacidade" sections={PRIVACY} />;
}
