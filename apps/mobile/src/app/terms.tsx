import { LegalPage } from '@/components/LegalPage';
import { TERMS } from '@/lib/legalText';

/** Termos de Uso (igual a /terms no site). */
export default function Terms() {
  return <LegalPage title="Termos de Uso" sections={TERMS} />;
}
