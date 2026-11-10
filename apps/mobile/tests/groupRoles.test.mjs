// Testes dos administradores de um TxillGroup (src/lib/groupRoles.ts) e da confirmação ao mudar quem vê e quem entra
// (accessChange em src/lib/groupAccess.ts).
// Correr em apps/mobile:  node --experimental-strip-types --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gr = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'groupRoles.ts')).href);
const ga = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'groupAccess.ts')).href);

const ids = (l) => l.map((a) => a.id);

test('memberActions: quem não é administrador não tem ações (nem na própria linha)', () => {
  for (const role of ['admin', 'member']) {
    assert.deepEqual(gr.memberActions({ myRole: 'member', me: 'ana', member: { username: 'rui', role } }), []);
  }
  assert.deepEqual(gr.memberActions({ myRole: 'member', me: 'ana', member: { username: 'ana', role: 'member' } }), []);
  assert.deepEqual(gr.memberActions({ myRole: undefined, me: 'ana', member: { username: 'rui', role: 'member' } }), []);
});

test('memberActions: administrador vê "Tornar administrador" num membro e "Retirar administrador" noutro admin, mais "Tirar"', () => {
  const m = gr.memberActions({ myRole: 'admin', me: 'ana', member: { username: 'rui', role: 'member' } });
  assert.deepEqual(ids(m), ['promote', 'remove']);
  assert.equal(m[0].label, 'Tornar administrador');
  assert.equal(m[0].role, 'admin');
  assert.equal(m[1].destructive, true);
  const a = gr.memberActions({ myRole: 'admin', me: 'ana', member: { username: 'rui', role: 'admin' } });
  assert.deepEqual(ids(a), ['demote', 'remove']);
  assert.equal(a[0].label, 'Retirar administrador');
  assert.equal(a[0].role, 'member');
});

test('memberActions: na minha linha, só "Deixar de ser administrador" (sem diferença de maiúsculas no username)', () => {
  const me = gr.memberActions({ myRole: 'admin', me: 'Ana', member: { username: 'ana', role: 'admin' } });
  assert.deepEqual(ids(me), ['step_down']);
  assert.equal(me[0].label, 'Deixar de ser administrador');
  assert.equal(me[0].role, 'member');
});

test('adminCount e stepDownNote: o último administrador é avisado; com dois, não', () => {
  const members = [{ role: 'admin' }, { role: 'member' }, { role: 'member' }];
  assert.equal(gr.adminCount(members), 1);
  assert.match(gr.stepDownNote(gr.adminCount(members)), /único administrador/);
  assert.equal(gr.stepDownNote(2), null);
  assert.equal(gr.adminCount([]), 0);
  assert.equal(gr.LAST_ADMIN_MESSAGE, 'O grupo precisa de pelo menos um administrador');
});

test('roleBadge, withRole e roleDoneText', () => {
  assert.equal(gr.roleBadge('admin'), 'Administrador');
  assert.equal(gr.roleBadge('member'), null);
  const before = [{ username: 'ana', role: 'admin' }, { username: 'Rui', role: 'member' }];
  const after = gr.withRole(before, 'rui', 'admin');
  assert.deepEqual(after.map((m) => m.role), ['admin', 'admin']);
  assert.equal(before[1].role, 'member', 'não muda a lista original');
  assert.equal(gr.roleDoneText('promote', 'Rui'), 'Rui agora é administrador.');
  assert.equal(gr.roleDoneText('step_down', 'Ana'), 'Deixaste de ser administrador.');
});

test('accessChange: sem mudança não há confirmação', () => {
  for (const a of ['private', 'map', 'public']) assert.equal(ga.accessChange(a, a, 3), null);
});

test('accessChange → Público: entra sem aprovação e vê o que já existe; sugere o privado no mapa', () => {
  const c = ga.accessChange('private', 'public', 0);
  assert.equal(c.title, 'Tornar o grupo público?');
  assert.deepEqual(c.lines, ['Qualquer pessoa pode entrar sem aprovação e, ao entrar, vê as mensagens, o álbum e as despesas que já existem no grupo.']);
  assert.equal(c.hint, 'Se preferires aprovar quem entra, escolhe Privado, visível no mapa.');
  assert.match(c.summary, /^Passa de Privado para Público\./);
  // Vindo do mapa, a sugestão é manter.
  assert.match(ga.accessChange('map', 'public', 2).hint, /mantém Privado, visível no mapa/);
});

test('accessChange → Privado: deixa de aparecer; os pedidos à espera vão ser recusados (singular e plural)', () => {
  const none = ga.accessChange('map', 'private', 0);
  assert.equal(none.title, 'Tornar o grupo privado?');
  assert.deepEqual(none.lines, ['O grupo deixa de aparecer em À tua volta e quem não está no grupo deixa de o encontrar.']);
  assert.equal(none.hint, undefined);
  assert.deepEqual(ga.accessChange('map', 'private', undefined).lines, none.lines);
  assert.equal(ga.accessChange('map', 'private', 1).lines[1], 'O pedido para entrar à espera vai ser recusado.');
  const many = ga.accessChange('map', 'private', 3);
  assert.equal(many.lines[1], 'Os 3 pedidos para entrar à espera vão ser recusados.');
  assert.match(many.summary, /Os 3 pedidos/);
  assert.equal(ga.accessChange('public', 'private', 0).lines.length, 1);
});

test('accessChange → Privado, visível no mapa: pede e um admin aprova; vindo de Público, passa a ser preciso aprovar', () => {
  const text = 'Aparece em À tua volta com o nome, a capa, a foto e o plano. Quem quiser entrar pede e um administrador aprova.';
  const fromPrivate = ga.accessChange('private', 'map', 0);
  assert.deepEqual(fromPrivate.lines, [text]);
  assert.equal(fromPrivate.title, 'Mostrar o grupo no mapa?');
  const fromPublic = ga.accessChange('public', 'map', 0);
  assert.deepEqual(fromPublic.lines, [text, 'A partir de agora é preciso aprovar quem entra.']);
  assert.equal(fromPublic.title, 'Passar a aprovar quem entra?');
});

test('o texto da opção Público já não diz que as conversas ficam escondidas de quem entra', () => {
  const pub = ga.ACCESS_OPTIONS.find((o) => o.id === 'public');
  assert.doesNotMatch(pub.text, /ficam só para quem está no grupo/);
  assert.match(pub.text, /Quem entra vê o que já foi partilhado/);
});

test('notifGroupTarget: "fez-te administrador" abre os detalhes do grupo', () => {
  assert.equal(ga.notifGroupTarget('group_admin_granted', 'g1'), '/messages/g/g1?info=1');
  assert.equal(ga.notifGroupTarget('group_admin_granted', null), null);
});
