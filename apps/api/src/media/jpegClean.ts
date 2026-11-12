/**
 * Tira os metadados de um JPEG sem o voltar a comprimir: copia os segmentos da imagem (tabelas, cabeçalho, os dados
 * comprimidos) e deixa de fora os que só levam informação (EXIF com o GPS e o aparelho, XMP, IPTC, comentários, as
 * imagens extra do MPF e tudo o que vier depois do fim da imagem, como o vídeo das "fotos animadas").
 *
 * Porquê: o reencode (sharp, JPEG q92) de uma foto que já vem a 92 % perde ~1,5–1,8 dB de cada vez (medido numa foto
 * de 2160×2700: o original fica ~20 % mais pequeno porque perde detalhe) e custa 0,4–1,3 s por foto. As fotos da
 * TxillCam e do editor saem de um canvas, sem rotação EXIF: estas passam assim, intactas.
 *
 * Fica só: APP0 (JFIF), APP2 com o perfil de cor (ICC_PROFILE), APP14 (Adobe, diz como ler as cores), DQT, DHT, DRI,
 * DAC, SOFn e SOS com os dados. Devolve null para tudo o que não for um JPEG simples e bem formado (marcadores raros,
 * ficheiro cortado): aí o servidor faz o reencode de sempre.
 */
export function stripJpegLossless(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  let sof = false, scan = false;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    // Bytes de enchimento (0xFF repetidos) antes do marcador.
    while (i + 1 < buf.length && buf[i + 1] === 0xff) i++;
    if (i + 1 >= buf.length) return null;
    const m = buf[i + 1];
    if (m === 0xd9) {
      // Fim da imagem: o que vier depois (MPF, vídeo, "trailers" de alguns telemóveis) não passa.
      if (!scan) return null;
      parts.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(parts);
    }
    if (m === 0x00 || m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) return null;
    if (i + 4 > buf.length) return null;
    const end = i + 2 + buf.readUInt16BE(i + 2);
    if (end > buf.length || end < i + 4) return null;
    const seg = buf.subarray(i, end);
    const kind = segmentKind(m, seg);
    if (kind === 'odd') return null;
    if (kind === 'keep') parts.push(seg);
    if (isSof(m)) sof = true;
    i = end;
    if (m === 0xda) {
      // Dados comprimidos: vão até ao próximo marcador (0xFF seguido de algo que não seja 0x00 nem um RSTn).
      if (!sof) return null;
      scan = true;
      let j = i;
      while (j + 1 < buf.length) {
        if (buf[j] === 0xff) {
          const n = buf[j + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { j += 2; continue; }
          if (n === 0xff) { j += 1; continue; }
          break;
        }
        j++;
      }
      if (j + 1 >= buf.length) return null; // sem fim da imagem: ficheiro cortado
      parts.push(buf.subarray(i, j));
      i = j;
    }
  }
  return null;
}

const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
const startsWith = (seg: Buffer, tag: string) => seg.length >= 4 + tag.length && seg.toString('latin1', 4, 4 + tag.length) === tag;

/** Fica, sai (só metadados) ou é estranho (não se arrisca: reencode). */
function segmentKind(m: number, seg: Buffer): 'keep' | 'drop' | 'odd' {
  if (m === 0xdb || m === 0xc4 || m === 0xdd || m === 0xcc || m === 0xda || isSof(m)) return 'keep';
  if (m === 0xe0) return startsWith(seg, 'JFIF\0') ? 'keep' : 'drop';
  if (m === 0xe2) return startsWith(seg, 'ICC_PROFILE\0') ? 'keep' : 'drop';
  if (m === 0xee) return startsWith(seg, 'Adobe') ? 'keep' : 'drop';
  if ((m >= 0xe1 && m <= 0xef) || m === 0xfe) return 'drop';
  return 'odd';
}
