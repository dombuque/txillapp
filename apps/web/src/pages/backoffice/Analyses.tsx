import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useCan } from './bo';
import AnCohorts from './ui/an-cohorts';
import AnContent from './ui/an-content';
import AnEngagement from './ui/an-engagement';
import AnGeleira from './ui/an-geleira';
import AnGeo from './ui/an-geo';
import AnHealth from './ui/an-health';
import AnSearch from './ui/an-search';
import AnVenues from './ui/an-venues';

/** Análises do backoffice (permissão insights.view): coortes, envolvimento, conteúdo, geografia, locais, Geleira, pesquisa e saúde. */
export default function BoAnalyses() {
  const can = useCan('insights.view');
  if (!can) return <p role="alert" className="py-10 text-center text-zinc-600">Sem acesso às Análises.</p>;
  return (
    <div data-an-root>
      {/* No telemóvel a barra lateral do backoffice não cabe: nas Análises esconde-se e os separadores de cima fazem de menu. */}
      <style>{'@media (max-width: 767px) { body:has([data-an-root]) aside { display: none !important; } body:has([data-an-root]) main { padding: 16px !important; } }'}</style>
      <Link to="/backoffice" className="mb-3 inline-block text-sm font-semibold text-zinc-600 underline md:hidden">← Backoffice</Link>
    <Routes>
      <Route index element={<Navigate to="coortes" replace />} />
      <Route path="coortes" element={<AnCohorts />} />
      <Route path="envolvimento" element={<AnEngagement />} />
      <Route path="conteudo" element={<AnContent />} />
      <Route path="geografia" element={<AnGeo />} />
      <Route path="locais" element={<AnVenues />} />
      <Route path="geleira" element={<AnGeleira />} />
      <Route path="pesquisa" element={<AnSearch />} />
      <Route path="saude" element={<AnHealth />} />
      <Route path="*" element={<Navigate to="coortes" replace />} />
    </Routes>
    </div>
  );
}
