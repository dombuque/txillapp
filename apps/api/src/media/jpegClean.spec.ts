import sharp from 'sharp';
import { stripJpegLossless } from './jpegClean';
import { stripImageMeta } from './media.service';

/** Uma "foto" com grão (não comprime demais), em RGB cru. */
function photo(w: number, h: number) {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = ((i * 7) ^ (i >> 7)) & 255;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } });
}
const pixels = async (b: Buffer) => (await sharp(b).raw().toBuffer());

describe('JPEG sem metadados e sem voltar a comprimir', () => {
  it('um JPEG de canvas (sem metadados) passa tal e qual: os mesmos bytes', async () => {
    const jpeg = await photo(640, 800).jpeg({ quality: 92 }).toBuffer();
    const out = stripJpegLossless(jpeg);
    expect(out).not.toBeNull();
    expect(out!.equals(jpeg)).toBe(true);
    // E pelo caminho do envio (stripImageMeta) também: nada de reencode.
    expect((await stripImageMeta(jpeg, 'image/jpeg'))!.equals(jpeg)).toBe(true);
    expect((await stripImageMeta(jpeg, 'image/jpeg', { fast: true }))!.equals(jpeg)).toBe(true);
  });

  it('tira o EXIF (GPS, aparelho), o XMP, os comentários e o que vem depois do fim; os píxeis ficam iguais', async () => {
    const base = await photo(320, 240).jpeg({ quality: 90 })
      .withExif({ IFD0: { Make: 'TxillPhone', Model: 'Segredo 9000' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '25/1 58/1 0/1' } })
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>Segredo</rdf:Description></rdf:RDF></x:xmpmeta>')
      .toBuffer();
    // Um comentário (COM) logo a seguir ao SOI, e um "vídeo" colado depois do fim (fotos animadas).
    const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x0c]), Buffer.from('Maputo 123')]);
    const jpeg = Buffer.concat([base.subarray(0, 2), com, base.subarray(2), Buffer.from('ftypmp42 GPS 25.9 32.5')]);
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const out = stripJpegLossless(jpeg)!;
    expect(out).not.toBeNull();
    const text = out.toString('latin1');
    for (const s of ['TxillPhone', 'Segredo', 'Maputo', 'ftyp', 'GPS']) expect(text).not.toContain(s);
    const m = await sharp(out).metadata();
    expect(m.exif).toBeUndefined();
    expect(m.xmp).toBeUndefined();
    expect([m.width, m.height]).toEqual([320, 240]);
    expect((await pixels(out)).equals(await pixels(base))).toBe(true);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
    const viaUpload = (await stripImageMeta(jpeg, 'image/jpeg'))!;
    expect(viaUpload.toString('latin1')).not.toContain('TxillPhone');
    expect((await pixels(viaUpload)).equals(await pixels(base))).toBe(true);
  });

  it('JPEG progressivo e com perfil de cor: fica o perfil, saem os metadados', async () => {
    const jpeg = await photo(480, 600).withIccProfile('p3').jpeg({ quality: 90, progressive: true }).withExif({ IFD0: { Make: 'TxillPhone' } }).toBuffer();
    const out = stripJpegLossless(jpeg)!;
    expect(out).not.toBeNull();
    const m = await sharp(out).metadata();
    expect(m.isProgressive).toBe(true);
    expect(m.icc).toBeDefined();
    expect(m.exif).toBeUndefined();
    expect((await pixels(out)).equals(await pixels(jpeg))).toBe(true);
  });

  it('foto rodada no EXIF (galeria): continua a ser endireitada (reencode)', async () => {
    const jpeg = await photo(400, 300).jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).withExifMerge({ IFD0: { Make: 'TxillPhone' } }).toBuffer();
    expect((await sharp(jpeg).metadata()).orientation).toBe(6);
    const out = (await stripImageMeta(jpeg, 'image/jpeg'))!;
    const m = await sharp(out).metadata();
    expect([m.width, m.height]).toEqual([300, 400]);
    expect(m.exif).toBeUndefined();
    expect(out.toString('latin1')).not.toContain('TxillPhone');
  });

  it('ficheiro cortado ou que não é JPEG: não arrisca (null)', async () => {
    const jpeg = await photo(320, 240).jpeg({ quality: 90 }).toBuffer();
    expect(stripJpegLossless(jpeg.subarray(0, Math.floor(jpeg.length / 2)))).toBeNull();
    expect(stripJpegLossless(Buffer.from('não sou um jpeg'))).toBeNull();
    expect(stripJpegLossless(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});
