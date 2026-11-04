/**
 * O som do fim de um reel: duas notas curtas a subir ("txi-lá"), geradas aqui (sem ficheiro de áudio).
 * Toca com um elemento de áudio normal, como o vídeo, para seguir as mesmas regras de som do aparelho.
 */
let url: string | null = null;

function build(): string {
  const rate = 22050;
  const notes: { f: number; at: number; len: number }[] = [
    { f: 659.25, at: 0, len: 0.16 },
    { f: 880, at: 0.14, len: 0.55 },
  ];
  const total = Math.ceil(rate * 0.75);
  const pcm = new Int16Array(total);
  for (const n of notes) {
    const start = Math.floor(n.at * rate);
    const count = Math.floor(n.len * rate);
    for (let i = 0; i < count && start + i < total; i++) {
      const t = i / rate;
      const env = Math.min(1, i / (rate * 0.008)) * Math.exp(-t * 7); // ataque curto e queda suave
      const s = Math.sin(2 * Math.PI * n.f * t) + 0.35 * Math.sin(2 * Math.PI * n.f * 2 * t);
      pcm[start + i] += Math.round(s * env * 9000);
    }
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export function playChime() {
  try {
    url ??= build();
    const a = new Audio(url);
    a.volume = 0.6;
    void a.play().catch(() => undefined);
  } catch {
    /* sem som: o cartão aparece na mesma */
  }
}
