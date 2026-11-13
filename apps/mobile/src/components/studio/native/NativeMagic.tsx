import { useEffect, useMemo } from 'react';
import type { MagicResult, MagicSource } from '@/lib/studio/magic';
import { nativeMagicAnalyzers } from '@/lib/studio/magicAnalyzeNative';
import { magicUploadFiles, startMagicUploads } from '@/lib/studio/magicUploads';
import { MagicMontage } from '../MagicMontage';
import { useMagicFrames } from './useMagicFrames';

/**
 * A «Montagem mágica» no telemóvel: a mesma `MagicMontage` do site, com a análise da app (lib/studio/magicAnalyzeNative.ts):
 * a grelha escondida que lê os frames dos vídeos e o som ouvido no servidor. Ao abrir, os vídeos começam logo a ir para o
 * servidor (lib/studio/magicUploads.ts): é lá que se ouve o som, e o «Seguinte» já não os volta a enviar.
 */
export function NativeMagic({ sources, draftId, music, onApply, onClose, onHasAudio, topInset, bottomInset }: {
  sources: MagicSource[];
  /** O rascunho do estúdio (o registo dos envios é o dele). */
  draftId: string;
  music?: { url: string; title?: string } | null;
  onApply: (r: MagicResult) => void;
  onClose: () => void;
  /** Um vídeo (pela chave `media`) tem ou não tem som. */
  onHasAudio: (media: string, hasAudio: boolean) => void;
  topInset?: number;
  bottomInset?: number;
}) {
  const frames = useMagicFrames();
  const videos = sources.filter((s) => s.video);
  const sendsVideos = videos.length > 0;
  const uploadSig = videos.map((s) => `${s.media ?? s.key}=${s.uri}`).join('|');
  useEffect(() => {
    if (!videos.length) return;
    startMagicUploads(draftId, magicUploadFiles(videos.map((s) => ({ media: s.media ?? s.key, uri: s.uri, mime: s.mime, video: true }))));
  }, [draftId, uploadSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const analyzers = useMemo(() => nativeMagicAnalyzers({ grab: frames.grab, draftId, onHasAudio }), [frames.grab, draftId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <MagicMontage sources={sources} music={music} capulana analyzers={analyzers} sendsVideos={sendsVideos} onApply={onApply} onClose={onClose} topInset={topInset} bottomInset={bottomInset} />
      {frames.node}
    </>
  );
}
