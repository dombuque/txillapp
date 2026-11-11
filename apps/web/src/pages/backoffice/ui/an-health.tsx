import { AnBars, SERIES } from './an-charts';
import { AnCard, AnEmpty, AnGrid, AnPage, AnTable, Num, PLATFORM, fmt, fmtPct, useAnalysis } from './an-kit';

interface Health {
  versions: { platform: string; version: string; people: number; sessions: number }[];
  errors: { platform: string; version: string; sessions: number; errors: number; sessionsWithErrorPct: number | null }[];
  messages: { platform: string; message: string; count: number; sessions: number }[];
  firstScreen: { platform: string; version: string; samples: number; p50: number | null; p75: number | null; p90: number | null }[];
  push: { platform: string; people: number | null; enabledPct: number | null }[];
}

/** Limites do primeiro ecrã útil (iguais aos das Estatísticas): bom até 2 s, a melhorar até 4 s. */
const rate = (ms: number | null) => (ms == null ? '—' : ms <= 2000 ? 'bom' : ms <= 4000 ? 'a melhorar' : 'mau');
const ms = (v: number | null) => (v == null ? '—' : `${(v / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} s`);

/** Erros por versão e plataforma, tempo do primeiro ecrã, versões em uso e notificações ligadas. */
export default function AnHealth() {
  const { q } = useAnalysis<Health>('health', 7);
  const r = q.data;
  const p = (x: string) => PLATFORM[x] ?? x;
  return (
    <AnPage
      title="Saúde da app"
      intro="Se a app rebenta, se abre depressa, que versões andam por aí e quem tem as notificações ligadas."
      state={q}
      how={
        <>
          <p><b>Sessões com erro:</b> % das sessões dessa versão em que a app registou pelo menos um erro. Uma versão nova com mais erros do que a anterior é sinal para corrigir já.</p>
          <p><b>Primeiro ecrã:</b> do arranque até ao primeiro ecrã útil. p50 é o tempo típico; p75 e p90 mostram os aparelhos mais lentos. Até 2 s é bom; mais de 4 s é mau.</p>
          <p><b>Notificações ligadas:</b> das pessoas que abriram a app nessa plataforma no período, quantas têm um aparelho (Android/iPhone) ou um browser registado para notificações.</p>
          <p>Estes números vêm dos eventos que a app envia; quem desligou «Ajudar a melhorar o Txillapp» não aparece.</p>
        </>
      }
    >
      {r && (
        <>
          <AnCard title="Notificações ligadas, por plataforma">
            {r.push.length === 0 ? <AnEmpty>Sem aberturas da app no período.</AnEmpty> : (
              <AnBars max={100} color={SERIES[2]} rows={r.push.map((x) => ({ label: p(x.platform), value: x.enabledPct ?? 0, text: <><Num v={x.enabledPct} pct /> de <Num v={x.people} /></> }))} />
            )}
          </AnCard>
          <AnGrid cols={2}>
            <AnCard title="Versões em uso" hint="Pessoas que abriram a app com cada versão">
              {r.versions.length === 0 ? <AnEmpty>Sem dados.</AnEmpty> : <AnBars rows={r.versions.map((v) => ({ label: `${p(v.platform)} · ${v.version}`, value: v.people, text: `${fmt(v.people)} pessoas · ${fmt(v.sessions)} sessões` }))} />}
            </AnCard>
            <AnCard title="Primeiro ecrã útil" hint="Por plataforma e versão">
              {r.firstScreen.length === 0 ? <AnEmpty>Sem medições.</AnEmpty> : (
                <AnTable
                  head={['Versão', 'p50', 'p75', 'p90', 'Medições']}
                  align={['l', 'r', 'r', 'r', 'r']}
                  rows={r.firstScreen.map((f) => [`${p(f.platform)} · ${f.version}`, ms(f.p50), `${ms(f.p75)} (${rate(f.p75)})`, ms(f.p90), fmt(f.samples)])}
                />
              )}
            </AnCard>
          </AnGrid>
          <AnCard title="Erros por versão e plataforma">
            {r.errors.length === 0 ? <AnEmpty>Sem sessões no período.</AnEmpty> : (
              <AnTable
                head={['Versão', 'Sessões', 'Erros', 'Sessões com erro']}
                align={['l', 'r', 'r', 'r']}
                rows={r.errors.map((e) => [`${p(e.platform)} · ${e.version}`, fmt(e.sessions), fmt(e.errors), fmtPct(e.sessionsWithErrorPct)])}
              />
            )}
          </AnCard>
          <AnCard title="Erros mais comuns">
            {r.messages.length === 0 ? <AnEmpty>Sem erros registados.</AnEmpty> : (
              <AnTable head={['Erro', 'Plataforma', 'Vezes', 'Sessões']} align={['l', 'l', 'r', 'r']} rows={r.messages.map((m) => [<code key="m" className="break-all text-xs">{m.message}</code>, p(m.platform), fmt(m.count), fmt(m.sessions)])} />
            )}
          </AnCard>
        </>
      )}
    </AnPage>
  );
}
