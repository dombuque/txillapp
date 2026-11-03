import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import Icon from './Icon';

/** Aviso discreto quando o aparelho fica sem ligação (some sozinho quando volta). */
export default function OfflineBar() {
  const [off, setOff] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOff(false);
    const out = () => setOff(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', out);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', out);
    };
  }, []);
  if (!off) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-zinc-900 px-4 py-1.5 text-center text-[13px] font-semibold text-white">
      <Icon name="alert" size={14} /> {tr('Sem ligação. O que enviares segue quando ela voltar.')}
    </div>
  );
}
