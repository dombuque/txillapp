import type { QueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { ApiError, api, type Post } from './api';
import { HIDE_LIST_KEYS, dropPost, hideErrorText, hideToastText } from './hidePost';
import { mergePost } from './postPatch';
import { showToast } from './toast';

/**
 * Ocultar (`hidden = true`) ou voltar a mostrar uma publicação minha (0169). Ao ocultar sai logo das listas em memória (o feed,
 * o perfil, os Reels…); a página dela fica, com o aviso «Oculta». No fim, um aviso curto com «Desfazer», e as listas voltam a
 * pedir-se ao servidor. Com o Bombar a decorrer, o servidor diz que não (409) e mostra-se a razão. `repost`: é o meu repost.
 */
export async function setPostHidden(qc: QueryClient, post: Pick<Post, 'id'>, hidden: boolean, repost = false): Promise<boolean> {
  let fresh: Post;
  try {
    fresh = await (hidden ? api.hidePost(post.id) : api.unhidePost(post.id));
  } catch (e) {
    const status = e instanceof ApiError ? e.status : null;
    Alert.alert(hidden ? 'Não deu para ocultar' : 'Não deu para mostrar', hideErrorText(status, e instanceof ApiError ? e.message : null));
    return false;
  }
  for (const q of qc.getQueryCache().getAll()) {
    const d = q.state.data;
    if (d === undefined) continue;
    const key = String(q.queryKey[0]);
    // O separador «Ocultas» é ao contrário: ao voltar a mostrar sai de lá.
    const hiddenTab = key === 'profile-posts' && q.queryKey[2] === 'hidden';
    let next = mergePost(d, post.id, { hidden: fresh.hidden === true });
    if ((hidden && !hiddenTab && (HIDE_LIST_KEYS as readonly string[]).includes(key)) || (!hidden && hiddenTab)) next = dropPost(next, post.id);
    if (next !== d) qc.setQueryData(q.queryKey, next);
  }
  for (const k of [...HIDE_LIST_KEYS, 'profile']) void qc.invalidateQueries({ queryKey: [k] });
  showToast(hideToastText(hidden, repost), { label: 'Desfazer', onPress: () => void setPostHidden(qc, post, !hidden, repost) });
  return true;
}
