import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { Wordmark } from '../components/ui';
import { BROWSER_OK_KEY, browserOk, mobileDevice, onAppHost, standalone, useInstall } from '../lib/install';

/** Em app.txillapp.com, no telemóvel e fora da app instalada, a instalação é obrigatória: é isto que se mostra em vez da app. */
export const installRequired = () => onAppHost() && mobileDevice() && !standalone() && !browserOk();

export default function InstallGate() {
  const { installed, canPrompt, iosHint, iosOpenInSafari, install } = useInstall();
  // O navegador não oferece instalar (por exemplo, o Firefox): só então deixamos continuar.
  // O Chrome só avisa que dá para instalar um instante depois de a página abrir: dá-lhe tempo antes de dizer que não dá.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const unsupported = waited && !installed && !canPrompt && !iosHint && !iosOpenInSafari;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center bg-white px-7 py-10 text-center">
      <img src="/favicon.svg?v=2" alt="" width={88} height={88} className="h-22 w-22 rounded-[22px] shadow-lg" />
      <h1 className="mt-6"><Wordmark className="mx-auto h-10" /></h1>

      {installed ? (
        <>
          <p className="mt-8 flex items-center gap-2 text-xl font-bold text-green-700"><Icon name="check-circle" size={26} /> Instalado!</p>
          <p className="mt-3 text-lg text-zinc-600">Abre o Txillapp pelo ícone no ecrã principal do teu telemóvel.</p>
        </>
      ) : (
        <>
          <p className="mt-8 text-2xl font-extrabold leading-tight">Instala o Txillapp para continuar</p>
          <p className="mt-3 text-lg text-zinc-600">A app abre em ecrã inteiro, mais rápida, com notificações e o ícone no teu telemóvel.</p>

          {canPrompt && (
            <button onClick={() => void install()} className="mt-8 h-14 w-full rounded-full bg-brand text-lg font-bold text-white shadow-[0_10px_24px_rgba(214,51,79,0.35)] active:scale-[0.98]">
              Instalar o Txillapp
            </button>
          )}
          {iosHint && (
            <ol className="mt-8 w-full space-y-3 text-left text-lg">
              <li className="flex items-center gap-3 rounded-2xl bg-zinc-100 px-4 py-3"><Icon name="share" size={26} className="shrink-0 text-brand" /> Toca em <b>Partilhar</b>, na barra do Safari</li>
              <li className="flex items-center gap-3 rounded-2xl bg-zinc-100 px-4 py-3"><Icon name="square-plus" size={26} className="shrink-0 text-brand" /> Escolhe <b>Adicionar ao ecrã principal</b></li>
              <li className="flex items-center gap-3 rounded-2xl bg-zinc-100 px-4 py-3"><Icon name="check" size={26} className="shrink-0 text-brand" /> Abre o Txillapp pelo novo ícone</li>
            </ol>
          )}
          {iosOpenInSafari && <p className="mt-8 rounded-2xl bg-zinc-100 px-4 py-4 text-lg">No iPhone, a instalação só funciona no <b>Safari</b>. Abre <b>app.txillapp.com</b> nele.</p>}
          {!canPrompt && !iosHint && !iosOpenInSafari && !unsupported && <p className="mt-8 text-zinc-500">A preparar a instalação…</p>}
          {unsupported && (
            <div className="mt-8 w-full">
              <p className="rounded-2xl bg-zinc-100 px-4 py-4 text-zinc-700">Este navegador não consegue instalar a app. No Android usa o <b>Chrome</b>; no iPhone usa o <b>Safari</b>.</p>
              <button
                onClick={() => {
                  try {
                    sessionStorage.setItem(BROWSER_OK_KEY, '1');
                  } catch {
                    /* sem armazenamento: não faz mal */
                  }
                  window.location.reload();
                }}
                className="mt-4 font-semibold text-brand underline"
              >
                Continuar no navegador
              </button>
            </div>
          )}
        </>
      )}
      <p className="mt-10 text-sm text-zinc-500">
        <Link to="/terms" className="underline">Termos</Link> · <Link to="/privacy" className="underline">Privacidade</Link>
      </p>
    </main>
  );
}
