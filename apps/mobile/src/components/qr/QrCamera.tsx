import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet } from 'react-native';
import { QrCameraNote } from './QrCameraNote';

export interface QrCameraProps {
  /** Parado (a mostrar o que se leu): a câmara fica, mas não lê. */
  paused: boolean;
  onRead: (data: string) => void;
  /** A câmara está a dar imagem (a moldura só varre quando está). */
  onLive?: (live: boolean) => void;
}

/**
 * A câmara do leitor de QR no telemóvel (expo-camera, só QR). A licença pede-se com um toque (quem vem só pela galeria
 * não leva com o pedido logo à entrada); recusada de vez, o botão abre as definições do telemóvel.
 * No site é QrCamera.web.tsx.
 */
export function QrCamera({ paused, onRead, onLive }: QrCameraProps) {
  const [perm, request, refresh] = useCameraPermissions();
  const [focused, setFocused] = useState(true);
  const [awake, setAwake] = useState(true);
  const last = useRef<{ data: string; at: number } | null>(null);
  const live = !!perm?.granted;
  useEffect(() => {
    onLive?.(live);
  }, [live, onLive]);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      // Ao voltar das definições, a licença pode ter mudado.
      const sub = AppState.addEventListener('change', (s) => {
        setAwake(s === 'active');
        if (s === 'active') void refresh().catch(() => undefined);
      });
      return () => {
        setFocused(false);
        sub.remove();
      };
    }, [refresh]),
  );

  if (!perm) return <QrCameraNote title="A abrir a câmara…" busy />;
  if (!perm.granted) {
    if (perm.canAskAgain) {
      return <QrCameraNote title="Ler com a câmara" sub="Aponta a câmara ao QR de outro telemóvel ou de um papel." action="Ligar a câmara" onAction={() => void request().catch(() => undefined)} />;
    }
    return (
      <QrCameraNote
        title="Sem acesso à câmara"
        sub="Deste a câmara como recusada. Liga-a nas definições do telemóvel, ou escolhe a imagem do QR da galeria."
        action="Abrir definições"
        onAction={() => void Linking.openSettings().catch(() => undefined)}
      />
    );
  }

  const onScan = (r: BarcodeScanningResult) => {
    const data = r.data;
    if (!data) return;
    // O mesmo QR chega muitas vezes por segundo: só conta uma vez (e outra vez só depois de 2 s).
    const now = Date.now();
    if (last.current && last.current.data === data && now - last.current.at < 2000) return;
    last.current = { data, at: now };
    onRead(data);
  };
  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="back"
      active={focused && awake}
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={paused ? undefined : onScan}
    />
  );
}
