import { track } from './analytics';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'txill_install_dismissed';
const SNOOZE_MS = 7 * 24 * 3600 * 1000;

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// O Chrome (Android) avisa uma só vez, cedo: guarda-se aqui para a app poder mostrar o botão quando quiser.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export const standalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** iPhone/iPad. No iOS não existe botão de instalar para sites: o Safari só permite "Adicionar ao ecrã principal". */
const ios = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
/** Só o Safari instala no iOS (Chrome/Firefox/Edge no iPhone não conseguem). */
const iosSafari = () => ios() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(navigator.userAgent);

/** O convite para instalar é só para telemóveis e tablets: no computador usa-se o site (txillapp.com). */
export const mobileDevice = () => typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || ios());

/** A app instalável vive em app.txillapp.com; txillapp.com é a apresentação e a versão web (instalar lá instalaria a apresentação). */
export const APP_URL = 'https://app.txillapp.com/';
export const onAppHost = () => typeof location !== 'undefined' && location.hostname === 'app.txillapp.com';
const onSiteHost = () => typeof location !== 'undefined' && /(^|\.)txillapp\.com$/.test(location.hostname) && !onAppHost();

const snoozed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < SNOOZE_MS;
  } catch {
    return false;
  }
};

export interface InstallState {
  /** Já está instalada (ou aberta como app): não mostrar nada. */
  installed: boolean;
  /** Android/Chrome: dá para instalar com um toque. */
  canPrompt: boolean;
  /** iPhone no Safari: mostrar as instruções (Partilhar → Adicionar ao ecrã principal). */
  iosHint: boolean;
  /** iPhone noutro browser: pedir para abrir no Safari. */
  iosOpenInSafari: boolean;
  /** O banner foi dispensado há pouco. */
  snoozed: boolean;
  /** Telemóvel em txillapp.com: "Instalar" leva a app.txillapp.com, onde a instalação é feita. */
  goToApp: boolean;
}

let snapshot: InstallState = compute();
function compute(): InstallState {
  const isInstalled = installed || standalone();
  const mobile = mobileDevice();
  const goToApp = mobile && !isInstalled && onSiteHost();
  const here = mobile && !isInstalled && !goToApp;
  return {
    installed: isInstalled,
    canPrompt: here && !!deferred,
    iosHint: here && iosSafari(),
    iosOpenInSafari: here && ios() && !iosSafari(),
    snoozed: snoozed(),
    goToApp,
  };
}
const same = (a: InstallState, b: InstallState) => (Object.keys(a) as (keyof InstallState)[]).every((k) => a[k] === b[k]);

export function useInstall() {
  const state = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => {
      const next = compute();
      if (!same(next, snapshot)) snapshot = next;
      return snapshot;
    },
  );

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener('change', emit);
    return () => mq.removeEventListener('change', emit);
  }, []);

  /** Abre o pedido do Chrome ("Instalar Txillapp?"). */
  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    track('install_accepted', { outcome });
    if (outcome === 'accepted') installed = true;
    emit();
  }, []);

  const snooze = useCallback(() => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* sem armazenamento: volta a aparecer na próxima visita */
    }
    emit();
  }, []);

  return { ...state, install, snooze };
}

/** Quem escolheu continuar no navegador (porque ele não consegue instalar) não volta a ver o ecrã de instalação nesta sessão. */
export const BROWSER_OK_KEY = 'txill_browser_ok';
export const browserOk = () => {
  try {
    return sessionStorage.getItem(BROWSER_OK_KEY) === '1';
  } catch {
    return false;
  }
};

/** txillapp.com não é instalável: instalar de lá guardaria a apresentação. Tira o que faria o iPhone/Android tratá-lo como app. */
export function neutralizeInstallOnSite() {
  if (!onSiteHost()) return;
  document.querySelectorAll('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"], link[rel="manifest"]').forEach((n) => n.remove());
}
