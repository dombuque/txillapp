import { test } from 'node:test';
import './fixtures/alias.mjs'; // o alias @/ (os módulos usam t() de @/lib/i18n)
import assert from 'node:assert/strict';
const { channelFor } = await import('../src/lib/channel.ts');

test('o canal da app: web, App Store no iPhone, beta no Android sem indicação, e o que o build disser', () => {
  assert.equal(channelFor('web', 'play'), 'web');
  assert.equal(channelFor('ios', undefined), 'appstore');
  assert.equal(channelFor('android', undefined), 'beta');
  assert.equal(channelFor('android', 'play'), 'play');
  assert.equal(channelFor('android', ' PLAY '), 'play');
  assert.equal(channelFor('android', 'outra'), 'beta');
});
