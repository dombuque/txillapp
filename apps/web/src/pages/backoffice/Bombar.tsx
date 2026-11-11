import { useState } from 'react';
import { PageHeader } from './bo';
import { BoostsPanel } from './ui/fin-boosts';
import { PeriodPicker } from './ui/fin-ui';

/** Bombar: as campanhas de todos os locais (ativas e passadas), resultados e Txills gastos. */
export default function Bombar() {
  const [days, setDays] = useState(30);
  return (
    <>
      <PageHeader title="Bombar" description="Destaques pagos com os Txills dos locais: o que está a bombar, resultados e quanto se gastou." actions={<PeriodPicker value={days} onChange={setDays} />} />
      <BoostsPanel days={days} />
    </>
  );
}
