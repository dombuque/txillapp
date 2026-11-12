import { sign } from 'crypto';
import { APPLE_ROOT_CA_G3, JwsError, parseRootCa, verifyAppleJws } from './apple';
import { APPLE_INTERMEDIATE_OID, APPLE_LEAF_OID, appleChain, makeCert, pem } from './iap-test-kit';

describe('JWS da App Store: cadeia x5c até à raiz, com o crypto do Node', () => {
  const chain = appleChain('unit');
  const roots = [parseRootCa(chain.rootPem)];

  it('a raiz verdadeira da Apple está embutida (Apple Root CA - G3)', () => {
    const g3 = parseRootCa(APPLE_ROOT_CA_G3);
    expect(g3.fingerprint256).toBe('63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79');
    expect(g3.ca).toBe(true);
    // Também em base64 (como num .env).
    expect(parseRootCa(Buffer.from(APPLE_ROOT_CA_G3).toString('base64')).fingerprint256).toBe(g3.fingerprint256);
  });

  it('aceita uma JWS assinada pela folha da cadeia de confiança', () => {
    const jws = chain.sign({ transactionId: '1', productId: 'p' });
    expect(verifyAppleJws(jws, roots)).toEqual({ transactionId: '1', productId: 'p' });
  });

  it('recusa outra raiz, conteúdo mexido, outro algoritmo e cadeias sem as extensões da Apple', () => {
    const other = appleChain('outra');
    expect(() => verifyAppleJws(other.sign({ a: 1 }), roots)).toThrow(JwsError);
    // Só com a raiz verdadeira da Apple, a cadeia de teste não passa.
    expect(() => verifyAppleJws(chain.sign({ a: 1 }), [parseRootCa(APPLE_ROOT_CA_G3)])).toThrow('A JWS não foi assinada pela Apple');

    const jws = chain.sign({ price: 100 });
    const [h, , s] = jws.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ price: 1 })).toString('base64url')}.${s}`;
    expect(() => verifyAppleJws(forged, roots)).toThrow('Assinatura da JWS inválida');
    expect(() => verifyAppleJws(chain.sign({}, { alg: 'HS256' }), roots)).toThrow('Algoritmo');
    expect(() => verifyAppleJws('a.b', roots)).toThrow(JwsError);

    // Uma folha sem a extensão da App Store (mesmo que bem assinada pela cadeia).
    const root = makeCert({ cn: 'R', ca: true });
    const inter = makeCert({ cn: 'I', issuer: root, ca: true, ext: [APPLE_INTERMEDIATE_OID] });
    const plain = makeCert({ cn: 'F', issuer: inter, ca: false });
    const jwsWith = (leaf: typeof plain, i = inter) => {
      const x5c = [leaf, i, root].map((c) => c.der.toString('base64'));
      const head = Buffer.from(JSON.stringify({ alg: 'ES256', x5c })).toString('base64url');
      const body = Buffer.from('{}').toString('base64url');
      return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), { key: leaf.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    };
    const r = [parseRootCa(pem(root.der))];
    expect(() => verifyAppleJws(jwsWith(plain), r)).toThrow('não é o da App Store');
    expect(verifyAppleJws(jwsWith(makeCert({ cn: 'F2', issuer: inter, ca: false, ext: [APPLE_LEAF_OID] })), r)).toEqual({});
    // Um intermédio que não é CA, ou um certificado fora da validade.
    const notCa = makeCert({ cn: 'I2', issuer: root, ca: false, ext: [APPLE_INTERMEDIATE_OID] });
    expect(() => verifyAppleJws(jwsWith(makeCert({ cn: 'F3', issuer: notCa, ca: false, ext: [APPLE_LEAF_OID] }), notCa), r)).toThrow('não é uma CA');
    const old = makeCert({ cn: 'F4', issuer: inter, ca: false, ext: [APPLE_LEAF_OID], notBefore: new Date('2020-01-01'), notAfter: new Date('2021-01-01') });
    expect(() => verifyAppleJws(jwsWith(old), r)).toThrow('fora da validade');
  });
});
