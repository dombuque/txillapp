import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { buildMontage, magicPhases, nextMagicSeed, type MagicItem, type MagicPhase, type MagicPhaseInfo, type MagicResult as Result, type MagicSource, type MusicInfo, type WaveId } from '@/lib/studio/magic';
import { analyzeMusic, analyzeSources, type AnalyzeOptions } from '@/lib/studio/magicAnalyze';
import { soundDoneLabel } from '@/lib/studio/magicFrames';
import { MagicProgress } from './MagicProgress';
import { MagicResult } from './MagicResult';
import { MagicWaves } from './MagicWaves';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Cada fase fica à vista pelo menos este tempo (ms), para se ler. */
const PHASE_MIN_MS = 420;

/** Os textos de privacidade quando os vídeos seguem logo para o servidor (na app). */
const SENDS_NOTE = 'Os vídeos já seguem para o nosso servidor, para ouvir o som e montar. As fotos ficam no telemóvel.';
const PROGRESS_NOTE = 'Só uns segundos. O som dos vídeos é ouvido no nosso servidor.';

/** O som dos vídeos quando não se ouve no aparelho (na app: o servidor). `heard`: quantos vídeos responderam. */
export type MagicSoundAnalyzer = (videos: MagicSource[], items: MagicItem[], opts?: AnalyzeOptions) => Promise<{ items: MagicItem[]; heard: number; withSound: number }>;

export interface MagicMontageProps {
  /** Os ficheiros escolhidos (os clipes do estúdio: `key`, `uri`, `video`, `mime`, `durationMs`, `speed`). */
  sources: MagicSource[];
  /** A música ou o som escolhido (o URL que o estúdio já toca) e o nome para mostrar. */
  music?: { url: string; title?: string } | null;
  /** O estúdio já desenha as transições, as molduras e as letras de capulana (ver docs/estudio-unico.md). */
  capulana?: boolean;
  initialWave?: WaveId;
  /** «Afinar»: a montagem escolhida, para o estúdio abrir na linha do tempo. */
  onApply: (result: Result) => void;
  onClose: () => void;
  topInset?: number;
  bottomInset?: number;
  /** Outra maneira de olhar para os ficheiros e para a música (no telemóvel: lib/studio/magicAnalyzeNative.ts). */
  analyzers?: { sources: typeof analyzeSources; music: typeof analyzeMusic; sound?: MagicSoundAnalyzer };
  /** Os vídeos vão já para o servidor (o som ouve-se lá): os textos de privacidade dizem-no. */
  sendsVideos?: boolean;
}

/**
 * O fluxo todo da «Montagem mágica», em ecrã inteiro: as ondas → «a montar» (a análise corre no aparelho) → o resultado,
 * com «Outra versão» e «Afinar». Quem o mostra decide onde (por cima do estúdio, num modal…).
 */
export function MagicMontage({ sources, music, capulana, initialWave, onApply, onClose, topInset, bottomInset, analyzers, sendsVideos }: MagicMontageProps) {
  const look = analyzers ?? { sources: analyzeSources, music: analyzeMusic };
  const [step, setStep] = useState<'ondas' | 'a-montar' | 'resultado'>('ondas');
  const [wave, setWave] = useState<WaveId>(initialWave ?? 'malta');
  const [active, setActive] = useState<MagicPhase | null>(null);
  const [done, setDone] = useState<MagicPhase[]>([]);
  const withSound = !!look.sound && sources.some((s) => s.video);
  const [phases, setPhases] = useState<MagicPhaseInfo[]>(() => magicPhases(withSound));
  const [result, setResult] = useState<Result | null>(null);
  const [locked, setLocked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const data = useRef<{ items: MagicItem[]; music: MusicInfo | null } | null>(null);
  const run = useRef<{ cancelled: boolean } | null>(null);
  const seed = useRef(1 + Math.floor(Math.random() * 9000));
  useEffect(() => () => { if (run.current) run.current.cancelled = true; }, []);

  const start = useCallback(async () => {
    const signal = { cancelled: false };
    if (run.current) run.current.cancelled = true;
    run.current = signal;
    setDone([]);
    setActive(null);
    setPhases(magicPhases(withSound));
    setLocked([]);
    setStep('a-montar');
    const stage = async <T,>(id: MagicPhase, fn: () => Promise<T> | T): Promise<T> => {
      setActive(id);
      const t0 = Date.now();
      const out = await fn();
      const left = PHASE_MIN_MS - (Date.now() - t0);
      if (left > 0) await sleep(left);
      if (!signal.cancelled) setDone((d) => [...d, id]);
      return out;
    };
    try {
      const videos = sources.filter((s) => s.video), photos = sources.filter((s) => !s.video);
      let iv = await stage('ver', () => look.sources(videos, { signal }));
      const ip = await stage('fotos', () => look.sources(photos, { signal }));
      // Na app, o som dos vídeos vem do servidor (os envios começaram quando a Montagem mágica abriu).
      if (look.sound && videos.length) {
        const heard = await stage('som', async () => {
          const r = await look.sound!(videos, iv, { signal });
          const note = soundDoneLabel(r.heard, r.withSound);
          if (note && !signal.cancelled) setPhases((l) => l.map((p) => (p.id === 'som' ? { ...p, done: note } : p)));
          return r;
        });
        iv = heard.items;
      }
      const items = [...iv, ...ip];
      // Uma primeira conta sem música só para saber quanto tempo a tcheka vai ter (é o tamanho do trecho a escolher).
      const rough = buildMontage({ sources, items, music: null, wave, seed: seed.current, capulana }).total;
      const info = await stage('ritmo', () => look.music(music?.url, wave, rough + 4, { signal }));
      data.current = { items, music: info };
      const res = await stage('historia', () => buildMontage({ sources, items, music: info, wave, seed: seed.current, capulana }));
      await stage('onda', () => sleep(120));
      if (signal.cancelled) return;
      setActive(null);
      setResult(res);
      setStep('resultado');
    } catch {
      if (!signal.cancelled) setStep('ondas');
    }
  }, [sources, music?.url, wave, capulana]); // eslint-disable-line react-hooks/exhaustive-deps

  const another = useCallback(async () => {
    if (!data.current || !result) return;
    setBusy(true);
    seed.current = nextMagicSeed(seed.current);
    const next = buildMontage({ sources, items: data.current.items, music: data.current.music, wave, seed: seed.current, capulana, keep: { result, locked } });
    await sleep(260);
    setResult(next);
    setBusy(false);
  }, [sources, wave, capulana, result, locked]);

  const cancel = useCallback(() => { if (run.current) run.current.cancelled = true; setStep('ondas'); }, []);

  return (
    <View style={{ flex: 1 }}>
      {step === 'ondas' ? (
        <MagicWaves privacy={sendsVideos ? SENDS_NOTE : undefined} value={wave} onChange={setWave} onStart={() => void start()} onClose={onClose} photos={sources.filter((s) => !s.video).length} videos={sources.filter((s) => s.video).length} musicTitle={music ? music.title || 'Música escolhida' : null} topInset={topInset} bottomInset={bottomInset} />
      ) : step === 'a-montar' || !result ? (
        <MagicProgress phases={phases} sub={sendsVideos ? PROGRESS_NOTE : undefined} wave={wave} active={active} done={done} onCancel={cancel} topInset={topInset} />
      ) : (
        <MagicResult
          result={result}
          musicUrl={music?.url}
          locked={locked}
          onToggleLock={(key) => setLocked((l) => (l.includes(key) ? l.filter((k) => k !== key) : [...l, key]))}
          onAnother={() => void another()}
          onTune={() => onApply(result)}
          onBack={() => setStep('ondas')}
          busy={busy}
          topInset={topInset}
          bottomInset={bottomInset}
        />
      )}
    </View>
  );
}
