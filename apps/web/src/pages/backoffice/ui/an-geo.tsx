import { AnBars, SERIES } from './an-charts';
import { AnCard, AnEmpty, AnGrid, AnPage, AnTable, AnTile, KHidden, Num, countryName, fmt, fmtPct, useAnalysis } from './an-kit';

interface Zone { lat: number; lng: number; people: number; posts?: number; label?: string | null }
interface Geo {
  activePeople: number | null;
  cities: { country: string | null; city: string; people: number; pct: number | null }[];
  otherCities: { cities: number; people: number | null };
  noCity: number | null;
  zones: Zone[];
  live: Zone[];
}

/** Zonas num plano simples (longitude × latitude): só células agregadas, nunca pontos de pessoas. */
function ZonePlot({ zones, color }: { zones: Zone[]; color: string }) {
  if (zones.length === 0) return null;
  const W = 320;
  const H = 240;
  const lats = zones.map((z) => z.lat);
  const lngs = zones.map((z) => z.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats) - 0.3, Math.max(...lats) + 0.3, Math.min(...lngs) - 0.3, Math.max(...lngs) + 0.3];
  const max = Math.max(...zones.map((z) => z.people));
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng || 1)) * (W - 20) + 10;
  const y = (lat: number) => H - (((lat - minLat) / (maxLat - minLat || 1)) * (H - 20) + 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md rounded-xl bg-zinc-50" role="img" aria-label="Zonas com mais pessoas">
      {zones.map((z, i) => (
        <circle key={i} cx={x(z.lng)} cy={y(z.lat)} r={4 + 16 * Math.sqrt(z.people / max)} fill={color} fillOpacity={0.55} stroke="#fff" strokeWidth={2}>
          <title>{`${z.label ?? `${z.lat}, ${z.lng}`}: ${z.people} pessoas`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Pessoas ativas por cidade e por zona (~11 km), sempre com 20 pessoas ou mais por célula. */
export default function AnGeo() {
  const { q } = useAnalysis<Geo>('geo');
  const r = q.data;
  return (
    <AnPage
      title="Geografia"
      intro="Onde está a malta ativa: pela cidade escolhida no perfil e pelas zonas onde se publica."
      state={q}
      how={
        <>
          <p><b>Por cidade:</b> pessoas com atividade no período, pela cidade que escreveram no perfil. Cidades com menos de 20 pessoas juntam-se em «outras cidades».</p>
          <p><b>Zonas:</b> quadrículas de cerca de 11 km (0,1 grau), contadas a partir do sítio escolhido nas publicações (que já é a posição do sítio, nunca a da pessoa). «Malta no mapa agora» usa só quem ligou essa opção, nas últimas 3 horas. Nunca há pontos individuais.</p>
        </>
      }
    >
      {r && (
        <>
          <AnGrid cols={3}>
            <AnTile label="Pessoas ativas no período" value={<Num v={r.activePeople} />} />
            <AnTile label="Em cidades pequenas (< 20)" value={<Num v={r.otherCities.people} />} hint={`${fmt(r.otherCities.cities)} cidades`} />
            <AnTile label="Sem cidade no perfil" value={<Num v={r.noCity} />} />
          </AnGrid>
          <AnCard title="Pessoas ativas por cidade" hint="Só cidades com 20 pessoas ou mais">
            {r.cities.length === 0 ? <AnEmpty>Nenhuma cidade chega a 20 pessoas ainda.</AnEmpty> : (
              <AnBars rows={r.cities.map((c) => ({ label: `${c.city} · ${countryName(c.country)}`, value: c.people, text: `${fmt(c.people)} · ${fmtPct(c.pct)}` }))} />
            )}
          </AnCard>
          <AnGrid cols={2}>
            <AnCard title="Zonas onde se publica" hint="Pessoas diferentes que publicaram com sítio, por zona de ~11 km">
              {r.zones.length === 0 ? <AnEmpty>Nenhuma zona com 20 pessoas ainda <KHidden /></AnEmpty> : (
                <div className="space-y-3">
                  <ZonePlot zones={r.zones} color={SERIES[0]} />
                  <AnTable head={['Zona', 'Pessoas', 'Publicações']} align={['l', 'r', 'r']} rows={r.zones.map((z) => [z.label ?? `${z.lat}, ${z.lng}`, fmt(z.people), fmt(z.posts ?? 0)])} />
                </div>
              )}
            </AnCard>
            <AnCard title="Malta no mapa agora" hint="Quem ligou «À tua volta», nas últimas 3 horas">
              {r.live.length === 0 ? <AnEmpty>Nenhuma zona com 20 pessoas agora <KHidden /></AnEmpty> : (
                <div className="space-y-3">
                  <ZonePlot zones={r.live} color={SERIES[1]} />
                  <AnTable head={['Zona (centro)', 'Pessoas']} align={['l', 'r']} rows={r.live.map((z) => [`${z.lat}, ${z.lng}`, fmt(z.people)])} />
                </div>
              )}
            </AnCard>
          </AnGrid>
        </>
      )}
    </AnPage>
  );
}
