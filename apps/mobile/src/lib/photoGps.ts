/**
 * Onde a foto foi tirada (GPS dos metadados EXIF), lido só no aparelho para sugerir o local da publicação.
 * As coordenadas nunca são enviadas tal como estão: servem para procurar sítios perto, e o servidor apaga os metadados das fotos.
 */
export interface PhotoGps { lat: number; lng: number }

function valid(lat: number, lng: number): PhotoGps | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** EXIF devolvido pelo expo-image-picker (`exif: true`): iOS e Android usam nomes ligeiramente diferentes. */
export function gpsFromExif(exif: Record<string, unknown> | null | undefined): PhotoGps | null {
  if (!exif) return null;
  const g = (exif['{GPS}'] as Record<string, unknown> | undefined) ?? exif;
  const num = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) return dms(v.map(Number));
    if (typeof v === 'string') {
      // Android: "25/1,58/1,1234/100"
      const parts = v.split(',').map((p) => { const [a, b] = p.split('/').map(Number); return b ? a / b : a; });
      return parts.length === 3 ? dms(parts) : Number(v);
    }
    return NaN;
  };
  let lat = num(g.GPSLatitude ?? g.Latitude);
  let lng = num(g.GPSLongitude ?? g.Longitude);
  const latRef = String(g.GPSLatitudeRef ?? g.LatitudeRef ?? 'N');
  const lngRef = String(g.GPSLongitudeRef ?? g.LongitudeRef ?? 'E');
  if (latRef.startsWith('S') && lat > 0) lat = -lat;
  if (lngRef.startsWith('W') && lng > 0) lng = -lng;
  return valid(lat, lng);
}

function dms(p: number[]): number {
  return (p[0] ?? 0) + (p[1] ?? 0) / 60 + (p[2] ?? 0) / 3600;
}

/** Lê o GPS de um JPEG no browser (só os primeiros 128 KB, onde está o EXIF). Sem GPS ou noutro formato: null. */
export async function gpsFromFile(file: File): Promise<PhotoGps | null> {
  try {
    const buf = await file.slice(0, 128 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return readTiff(v, off + 10);
      if ((marker & 0xff00) !== 0xff00 || len < 2) return null;
      off += 2 + len;
    }
  } catch {
    /* sem EXIF legível */
  }
  return null;
}

function readTiff(v: DataView, start: number): PhotoGps | null {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o: number) => v.getUint16(start + o, le);
  const u32 = (o: number) => v.getUint32(start + o, le);
  const ifd0 = u32(4);
  const entries = (dir: number) => {
    const n = u16(dir);
    const out = new Map<number, { type: number; count: number; at: number }>();
    for (let i = 0; i < n; i++) {
      const e = dir + 2 + i * 12;
      if (start + e + 12 > v.byteLength) break;
      out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
    }
    return out;
  };
  const gpsPtr = entries(ifd0).get(0x8825);
  if (!gpsPtr) return null;
  const gps = entries(u32(gpsPtr.at));
  const ref = (tag: number) => { const e = gps.get(tag); return e ? String.fromCharCode(v.getUint8(start + e.at)) : ''; };
  const rational3 = (tag: number) => {
    const e = gps.get(tag);
    if (!e || e.type !== 5 || e.count < 3) return NaN;
    const o = u32(e.at);
    const r = (k: number) => { const d = u32(o + k * 8 + 4); return d ? u32(o + k * 8) / d : 0; };
    return dms([r(0), r(1), r(2)]);
  };
  let lat = rational3(2);
  let lng = rational3(4);
  if (ref(1) === 'S') lat = -lat;
  if (ref(3) === 'W') lng = -lng;
  return valid(lat, lng);
}
