import { MusicProvider, MusicTrack, ProviderContext, TakedownNotice, UsageRow } from './music-provider';

interface FakeTrack extends Omit<MusicTrack, 'previewUrl' | 'source' | 'license'> {
  /** Os países onde a faixa está licenciada (como num contrato real, faixa a faixa). */
  territories: string[];
  rank: number;
}

/** Catálogo simulado (nomes inventados): nada sai da máquina. */
const CATALOG: FakeTrack[] = [
  { id: 'lic-1', title: 'Marrabenta da Baixa', artist: 'Banda Exemplo', duration: 214, cover: 'https://licensed.invalid/cover/lic-1.jpg', styles: ['marrabenta'], territories: ['MZ', 'ZA', 'AO'], rank: 1 },
  { id: 'lic-2', title: 'Amapiano do Bairro', artist: 'DJ Exemplo', duration: 245, cover: null, styles: ['amapiano'], territories: ['MZ', 'ZA'], rank: 2 },
  { id: 'lic-3', title: 'Kizomba Só Para Joanesburgo', artist: 'Cantora Exemplo', duration: 198, cover: null, styles: ['kizomba'], territories: ['ZA'], rank: 3 },
];

/**
 * Adaptador simulado do fornecedor «licensed» (MUSIC_LICENSED_DRIVER=fake), para os testes e o desenvolvimento.
 * Comporta-se como um agregador real: territórios por faixa, excertos assinados que expiram, relatórios e avisos de remoção.
 * Proibido em produção (config.ts).
 */
export class FakeLicensedProvider implements MusicProvider {
  readonly source = 'licensed';
  /** O que já nos entregaram nos relatórios (para os testes verem). */
  readonly reported: UsageRow[] = [];
  private readonly notices: TakedownNotice[] = [];
  private readonly removed = new Set<string>();

  /** Simula a editora a mandar tirar uma faixa. */
  queueTakedown(trackId: string, reason = 'A editora retirou a faixa') {
    this.notices.push({ trackId, reason, at: new Date().toISOString() });
    this.removed.add(trackId);
  }

  private visible(country: string) {
    return CATALOG.filter((t) => !this.removed.has(t.id) && t.territories.includes(country));
  }

  private out(t: FakeTrack): MusicTrack {
    const { territories: _t, rank: _r, ...rest } = t;
    return { ...rest, previewUrl: null, source: this.source, license: 'licensed' };
  }

  async search(q: string, ctx: ProviderContext & { limit: number }) {
    const needle = q.toLowerCase();
    return this.visible(ctx.country)
      .filter((t) => `${t.title} ${t.artist} ${t.styles.join(' ')}`.toLowerCase().includes(needle))
      .slice(0, ctx.limit)
      .map((t) => this.out(t));
  }

  async trending(ctx: ProviderContext & { limit: number }) {
    return this.visible(ctx.country).sort((a, b) => a.rank - b.rank).slice(0, ctx.limit).map((t) => this.out(t));
  }

  async track(id: string, ctx: ProviderContext) {
    const t = this.visible(ctx.country).find((x) => x.id === id);
    return t ? this.out(t) : null;
  }

  async previewUrl(id: string, ctx: ProviderContext & { maxSeconds: number }) {
    if (!(await this.track(id, ctx))) return null;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    return { url: `https://licensed.invalid/clip/${encodeURIComponent(id)}.m4a?max=${ctx.maxSeconds}&c=${ctx.country}&exp=${encodeURIComponent(expiresAt)}`, expiresAt };
  }

  async reportUsage(rows: UsageRow[]) {
    this.reported.push(...rows);
    return { accepted: rows.length };
  }

  async takedowns(since: Date) {
    return this.notices.filter((n) => new Date(n.at) >= since);
  }
}
