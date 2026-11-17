// Os textos dos mapas (mapRuntime.ts não importa nada: corre também dentro da WebView da app) no idioma da pessoa.
import { monthNames, t } from '@/lib/i18n';
import type { MapLabels } from './mapRuntime';

export function mapLabels(): MapLabels {
  return {
    zoomIn: t('Aproximar'),
    zoomOut: t('Afastar'),
    recenter: t('Voltar ao centro'),
    recenterAria: t('Voltar ao centro da procura'),
    places: t('{n} sítios'),
    sponsoredTitle: t('{title} · Patrocinado'),
    sponsored: t('Patrocinado'),
    km: t('{km} km'),
    months: monthNames('short').map((m) => m.replace(/\.$/, '').toLocaleUpperCase()),
  };
}
