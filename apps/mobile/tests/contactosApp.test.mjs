// «Amigos nos contactos» na app (Android e iPhone): a permissão do sistema, só os emails, o SHA-256 pelo expo-crypto, e o
// botão nas boas-vindas («Segue a malta»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('na app lê os emails dos contactos com a permissão e cifra-os antes de enviar', () => {
  const c = read('lib/contacts.ts');
  assert.match(c, /export const nativeContacts = Platform\.OS === 'android' \|\| Platform\.OS === 'ios';/);
  assert.match(c, /await Contacts\.requestPermissionsAsync\(\)/);
  assert.match(c, /fields: \[Contacts\.Fields\.Emails\]/);
  assert.match(c, /Crypto\.digestStringAsync\(Crypto\.CryptoDigestAlgorithm\.SHA256/);
  assert.match(c, /\.slice\(0, MAX_CONTACT_EMAILS\)/);
  assert.match(read('components/WelcomeTour.tsx'), /<FindContacts onClose=\{\(\) => setContacts\(false\)\} \/>/);
});
