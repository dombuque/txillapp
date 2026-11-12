import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Platform } from 'react-native';
import { createPasteGate, imageFromTransfer, pastedImageProblem, transferHasFiles, type TransferLike } from './pasteImage';

/** A imagem colada à espera de "Enviar" ou "Cancelar": um URL de objeto (blob:) e o tipo. */
export interface PastedImage { uri: string; type: string }

/**
 * Colar (Ctrl+V, ⌘V, "Colar", ou "Fotografia — Colar das capturas de ecrã" no teclado do iPhone) ou arrastar uma imagem
 * para a caixa de mensagem, no site. No react-native-web o ref do TextInput é o próprio textarea: juntam-se-lhe os
 * ouvintes `paste`, `beforeinput` (o iPhone às vezes só manda a imagem aqui), `dragover` e `drop`.
 * Com imagem, o browser não cola nada e a imagem fica em `pending` (a caixa mostra a pré-visualização com Enviar e
 * Cancelar). Sem imagem (texto), nada muda. No telemóvel (app) não faz nada: o TextInput nativo não dá imagens coladas.
 *
 * `inputRef` continua a apontar para o campo (o ref devolvido junta os dois). `onProblem`: a imagem não dá para enviar
 * (GIF, formato ou tamanho). `onOpen`: abriu a pré-visualização (para fechar os stickers e o menu "+").
 */
export function usePastedImage<T>({ inputRef, onProblem, onOpen }: { inputRef?: RefObject<T | null>; onProblem: (msg: string) => void; onOpen?: () => void }) {
  const [pending, setPending] = useState<PastedImage | null>(null);
  const cbs = useRef({ onProblem, onOpen });
  useEffect(() => { cbs.current = { onProblem, onOpen }; });
  const [gate] = useState(createPasteGate);
  const attached = useRef<{ node: unknown; off: () => void } | null>(null);
  /** O mesmo que largar na caixa, para quem a chama de fora (a zona de largar da conversa, no computador). */
  const dropRef = useRef<((e: Event, dt: DataTransfer | null) => void) | null>(null);
  /** A mesma imagem de `pending`, para os ouvintes e o fim (sempre posta junto com `setPending`). */
  const current = useRef<PastedImage | null>(null);

  const release = useCallback((p: PastedImage | null | undefined) => {
    if (p) try { URL.revokeObjectURL(p.uri); } catch { /* já largado */ }
  }, []);

  const ref = useCallback((node: T | null) => {
    if (inputRef) (inputRef as { current: T | null }).current = node;
    if (attached.current?.node === node) return;
    attached.current?.off();
    attached.current = null;
    const el = node as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !el || typeof el.addEventListener !== 'function') return;

    const take = (e: Event, dt: TransferLike | null | undefined, preferText: boolean) => {
      const img = imageFromTransfer<File>(dt, { preferText });
      if (!img) return false;
      e.preventDefault();
      e.stopPropagation();
      if (!gate.accept(img, Date.now())) return true;
      const problem = pastedImageProblem(img);
      if (problem) { cbs.current.onProblem(problem); return true; }
      const next = { uri: URL.createObjectURL(img.file), type: img.type };
      release(current.current);
      current.current = next;
      setPending(next);
      cbs.current.onOpen?.();
      return true;
    };
    const onPaste = (e: Event) => { take(e, (e as ClipboardEvent).clipboardData, true); };
    const onBeforeInput = (e: Event) => {
      const ie = e as InputEvent;
      if (ie.inputType === 'insertFromPaste') take(e, ie.dataTransfer, true);
    };
    const onDragOver = (e: Event) => {
      const dt = (e as DragEvent).dataTransfer;
      if (!transferHasFiles(dt)) return;
      e.preventDefault();
      if (dt) dt.dropEffect = 'copy';
    };
    const dropped = (e: Event, dt: DataTransfer | null) => {
      if (take(e, dt, false)) return;
      // Um ficheiro que não é imagem: não o deixar abrir por cima da app.
      if (transferHasFiles(dt)) {
        e.preventDefault();
        cbs.current.onProblem('Só dá para largar aqui imagens (JPEG, PNG ou WebP).');
      }
    };
    dropRef.current = dropped;
    const onDrop = (e: Event) => dropped(e, (e as DragEvent).dataTransfer);
    el.addEventListener('paste', onPaste);
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    attached.current = {
      node,
      off: () => {
        el.removeEventListener('paste', onPaste);
        el.removeEventListener('beforeinput', onBeforeInput);
        el.removeEventListener('dragover', onDragOver);
        el.removeEventListener('drop', onDrop);
        if (dropRef.current === dropped) dropRef.current = null;
      },
    };
  }, [inputRef, gate, release]);

  // Ao sair da conversa: tira os ouvintes e larga a imagem que ficou por enviar.
  useEffect(() => () => { attached.current?.off(); attached.current = null; release(current.current); }, [release]);

  /** "Cancelar": fecha a pré-visualização e larga a imagem. */
  const cancel = useCallback(() => { release(current.current); current.current = null; setPending(null); }, [release]);
  /** "Enviar": fecha a pré-visualização e devolve a imagem (quem envia chama `release` no fim). */
  const take = useCallback(() => { const p = current.current; current.current = null; setPending(null); return p; }, []);

  /** Largar fora da caixa (a zona de largar da conversa): imagem → pré-visualização; outro ficheiro → o aviso. */
  const drop = useCallback((e: Event, dt: DataTransfer | null) => { dropRef.current?.(e, dt); }, []);

  return { ref, pending, cancel, take, release, drop };
}
