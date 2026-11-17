import MixarScreen from '../[id]';

/**
 * Os Guardados do Mixar (docs/mixar-contrato.md, «Social e guardados»): a coleção dos dois, no mesmo feed vertical do Mixar
 * (app/mixar/[id].tsx com `saved`), do mais recente para o mais antigo, sem o que os autores ocultaram ou a moderação removeu.
 */
export default function MixarSavedScreen() {
  return <MixarScreen saved />;
}
