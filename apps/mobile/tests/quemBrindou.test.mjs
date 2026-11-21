// «Quem brindou» um comentário: tocar na contagem de brindes abre a lista (publicações e mimos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('a contagem de brindes de um comentário abre a lista de quem brindou', () => {
  const api = read('lib/api.ts');
  assert.match(api, /commentCheers: \(id: string\): Promise<CheerPerson\[\]> => raw\(`\/comments\/\$\{id\}\/cheers`\)/);
  assert.match(api, /storyCommentCheers: \(commentId: string\): Promise<CheerPerson\[\]> => raw\(`\/stories\/comments\/\$\{commentId\}\/cheers`\)/);
  const sheet = read('components/PeopleSheet.tsx');
  assert.match(sheet, /export function CommentCheersSheet/);
  assert.match(sheet, /story \? api\.storyCommentCheers\(commentId\) : api\.commentCheers\(commentId\)/);
  const post = read('components/CommentsSheet.tsx');
  assert.match(post, /onPress=\{\(\) => setCheersOpen\(true\)\}[^\n]*accessibilityLabel=\{t\('Ver quem brindou'\)\}/);
  assert.match(post, /<CommentCheersSheet commentId=\{c\.id\} onClose=/);
  const mimo = read('components/StoryParts.tsx');
  assert.match(mimo, /onPress=\{\(\) => setCheersOpen\(true\)\}[^\n]*accessibilityLabel=\{t\('Ver quem brindou'\)\}/);
  assert.match(mimo, /<CommentCheersSheet commentId=\{c\.id\} story onClose=/);
});
