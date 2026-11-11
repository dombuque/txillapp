import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from './bo';
import type { FinLedgerFilter } from './ui/fin-api';
import { LedgerPanel } from './ui/fin-ledger';
import { FinOverviewPanel } from './ui/fin-overview';
import { PurchasesPanel } from './ui/fin-purchases';
import { TxDialog } from './ui/fin-tx';
import { PeriodPicker, Tabs } from './ui/fin-ui';
import { VenueWalletsPanel } from './ui/fin-venues';

type Tab = 'resumo' | 'movimentos' | 'locais' | 'compras';
const TABS: { id: Tab; label: string }[] = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'movimentos', label: 'Movimentos' },
  { id: 'locais', label: 'Carteiras dos locais' },
  { id: 'compras', label: 'Compras de Txills' },
];
const PERIODS = [7, 30, 90];

/** Finanças (wallet.view): Txills em circulação, livro de movimentos, carteiras dos locais e compras. Só leitura (o Bombar tem página própria). */
export default function Finance() {
  const [sp, setSp] = useSearchParams();
  const [tx, setTx] = useState<string | null>(null);
  const tab = (TABS.some((t) => t.id === sp.get('tab')) ? sp.get('tab') : 'resumo') as Tab;
  const days = PERIODS.includes(Number(sp.get('days'))) ? Number(sp.get('days')) : 30;
  const filter: FinLedgerFilter = { type: sp.get('type') ?? '', account: sp.get('account') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '' };
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    setSp(next, { replace: true });
  };
  const goLedger = (f: Partial<FinLedgerFilter>) => update({ tab: 'movimentos', type: '', account: '', from: '', to: '', ...f });

  return (
    <>
      <PageHeader title="Finanças" description="Txills em circulação, movimentos, carteiras dos locais e compras de Txills. Só leitura."
        actions={tab !== 'movimentos' ? <PeriodPicker value={days} onChange={(d) => update({ days: String(d) })} options={PERIODS} /> : undefined} />
      <Tabs value={tab} onChange={(t) => update({ tab: t === 'resumo' ? '' : t })} items={TABS} />
      {tab === 'resumo' && <FinOverviewPanel days={days} onAccount={(account) => goLedger({ account })} onType={(type) => goLedger({ type })} />}
      {/* key: os filtros do endereço (vindos de um alerta ou de um local) entram no formulário. */}
      {tab === 'movimentos' && <LedgerPanel key={JSON.stringify(filter)} filter={filter} onFilter={(f) => update({ ...f })} />}
      {tab === 'locais' && <VenueWalletsPanel days={days} onAccount={(account) => goLedger({ account })} />}
      {tab === 'compras' && <PurchasesPanel days={days} onTx={setTx} />}
      {tx && <TxDialog id={tx} onClose={() => setTx(null)} />}
    </>
  );
}
