import sharp from 'sharp';
import { decide, type DecisionRules } from './image-moderation.service';
import { NUDENET_LABELS, decodeYolo, iou, letterbox, nms, preprocess, type Detection, type NudeLabel } from './nudenet';

const det = (label: NudeLabel, score: number, box: Detection['box'] = [0, 0, 10, 10]): Detection => ({ label, score, box });

describe('NudeNet: letterbox', () => {
  it('foto ao alto: a altura enche o quadrado, o preto fica à direita', () => {
    expect(letterbox(1080, 1440, 640)).toEqual({ scale: 640 / 1440, width: 480, height: 640, padRight: 160, padBottom: 0 });
  });
  it('foto deitada: o preto fica em baixo', () => {
    expect(letterbox(4000, 3000, 320)).toEqual({ scale: 0.08, width: 320, height: 240, padRight: 0, padBottom: 80 });
  });
  it('quadrada e pequena: aumenta até ao tamanho do modelo, sem preto', () => {
    expect(letterbox(100, 100, 320)).toMatchObject({ width: 320, height: 320, padRight: 0, padBottom: 0 });
  });
  it('muito estreita: nunca fica com 0 píxeis', () => {
    expect(letterbox(1, 5000, 320)).toMatchObject({ width: 1, height: 320 });
  });
});

describe('NudeNet: NMS e caixas', () => {
  it('IoU', () => {
    expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
    expect(iou([0, 0, 10, 10], [20, 20, 5, 5])).toBe(0);
    expect(iou([0, 0, 10, 10], [5, 0, 10, 10])).toBeCloseTo(50 / 150);
  });

  it('fica a mais confiante das que se sobrepõem, mesmo sendo de classes diferentes (como o cv2.dnn.NMSBoxes)', () => {
    const out = nms([det('FEMALE_BREAST_COVERED', 0.7, [0, 0, 10, 10]), det('FEMALE_BREAST_EXPOSED', 0.5, [1, 0, 10, 10]), det('FACE_FEMALE', 0.9, [50, 50, 10, 10])]);
    expect(out.map((d) => d.label)).toEqual(['FACE_FEMALE', 'FEMALE_BREAST_COVERED']);
  });

  it('tira as que ficam abaixo de 0.25 e mantém as que mal se tocam', () => {
    const out = nms([det('FEET_EXPOSED', 0.24), det('BELLY_EXPOSED', 0.6, [0, 0, 10, 10]), det('BELLY_COVERED', 0.5, [7, 0, 10, 10])]);
    expect(out.map((d) => d.label)).toEqual(['BELLY_EXPOSED', 'BELLY_COVERED']);
  });

  it('lê a saída do YOLOv8 ([4 + 18 classes] × âncoras) e põe as caixas na imagem original', () => {
    const anchors = 3;
    const out = new Float32Array((4 + NUDENET_LABELS.length) * anchors);
    const set = (row: number, a: number, v: number) => (out[row * anchors + a] = v);
    // Âncora 0: mamilo exposto em (cx 100, cy 50, 40 × 20) no modelo de 320, imagem 640 × 480 (escala 0.5).
    [100, 50, 40, 20].forEach((v, r) => set(r, 0, v));
    set(4 + NUDENET_LABELS.indexOf('FEMALE_BREAST_EXPOSED'), 0, 0.81);
    set(4 + NUDENET_LABELS.indexOf('FEMALE_BREAST_COVERED'), 0, 0.1);
    // Âncora 1: abaixo de 0.2, não conta.
    [10, 10, 5, 5].forEach((v, r) => set(r, 1, v));
    set(4 + NUDENET_LABELS.indexOf('ANUS_EXPOSED'), 1, 0.19);
    // Âncora 2: sai pela direita da imagem: é cortada.
    [315, 100, 30, 30].forEach((v, r) => set(r, 2, v));
    set(4 + NUDENET_LABELS.indexOf('FACE_MALE'), 2, 0.5);
    const d = decodeYolo(out, anchors, 0.5, 640, 480);
    expect(d).toHaveLength(2);
    expect(d[0].label).toBe('FEMALE_BREAST_EXPOSED');
    expect(d[0].score).toBeCloseTo(0.81);
    expect(d[0].box).toEqual([160, 80, 80, 40]);
    expect(d[1].label).toBe('FACE_MALE');
    expect(d[1].box[0]).toBe(600);
    expect(d[1].box[0] + d[1].box[2]).toBe(640);
  });

  it('pré-processamento: [1, 3, N, N], RGB de 0 a 1, a foto no canto de cima à esquerda e preto no resto', async () => {
    const red = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
    const p = await preprocess(red, 64);
    expect(p.tensor).toHaveLength(3 * 64 * 64);
    expect(p).toMatchObject({ scale: 64 / 200, width: 200, height: 100 });
    const at = (c: number, y: number, x: number) => p.tensor[c * 64 * 64 + y * 64 + x];
    expect(at(0, 10, 10)).toBeCloseTo(1);
    expect(at(1, 10, 10)).toBeCloseTo(0);
    expect(at(0, 60, 10)).toBe(0); // em baixo: preto
  });

  it('pré-processamento: fotos a preto e branco e com transparência também dão três canais', async () => {
    const grey = await sharp({ create: { width: 30, height: 50, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 0.5 } } }).grayscale().png().toBuffer();
    const p = await preprocess(grey, 32);
    expect(p.tensor).toHaveLength(3 * 32 * 32);
  });
});

describe('decisão combinada', () => {
  const r: DecisionRules = { autoReject: true, rejectConfidence: 0.6, reviewConfidence: 0.4, rejectMinScore: 0, reviewScore: 0.85 };

  it('o classificador sozinho nunca recusa (no máximo manda para a moderação)', () => {
    expect(decide(0.99, [], r)).toMatchObject({ verdict: 'review', reason: 'classificador 99%, sem partes expostas detetadas' });
    expect(decide(0.99, null, r).verdict).toBe('review');
    expect(decide(0.7, [det('FEMALE_BREAST_COVERED', 0.9), det('ARMPITS_EXPOSED', 0.8), det('BELLY_EXPOSED', 0.8)], r).verdict).toBe('ok');
  });

  it('recusa só com prova: genitais, ânus ou mamilos femininos expostos com confiança alta', () => {
    expect(decide(0.4, [det('FACE_FEMALE', 0.9), det('FEMALE_BREAST_EXPOSED', 0.78)], r)).toMatchObject({ verdict: 'reject', reason: 'Detetado: mamilos femininos expostos (78%)' });
    expect(decide(0.9, [det('MALE_GENITALIA_EXPOSED', 0.61)], r).verdict).toBe('reject');
    expect(decide(0.9, [det('ANUS_EXPOSED', 0.7)], r).reason).toBe('Detetado: ânus exposto (70%)');
  });

  it('com menos confiança, ou nádegas expostas: moderação, com o motivo', () => {
    expect(decide(0.5, [det('FEMALE_GENITALIA_EXPOSED', 0.45)], r)).toMatchObject({ verdict: 'review', reason: 'Detetado: genitais femininos expostos (45%) · classificador 50%' });
    expect(decide(0.5, [det('BUTTOCKS_EXPOSED', 0.9)], r)).toMatchObject({ verdict: 'review', reason: 'Detetado: nádegas expostas (90%) · classificador 50%' });
    expect(decide(0.5, [det('FEMALE_BREAST_EXPOSED', 0.3)], r).verdict).toBe('ok');
    // Peito masculino exposto (tronco nu na praia) não conta.
    expect(decide(0.6, [det('MALE_BREAST_EXPOSED', 0.95)], r).verdict).toBe('ok');
  });

  it('peito de homem confundido com mamilos femininos (só rosto masculino): nunca recusa', () => {
    const man = [det('FACE_MALE', 0.8), det('MALE_BREAST_EXPOSED', 0.6)];
    expect(decide(0.7, [...man, det('FEMALE_BREAST_EXPOSED', 0.53)], r).verdict).toBe('ok');
    expect(decide(0.7, [...man, det('FEMALE_BREAST_EXPOSED', 0.8)], r)).toMatchObject({ verdict: 'review', reason: 'Detetado: mamilos femininos expostos (80%), com rosto masculino · classificador 70%' });
    // Com um rosto de mulher mais forte, conta como sempre; e os genitais recusam com qualquer rosto.
    expect(decide(0.7, [...man, det('FACE_FEMALE', 0.9), det('FEMALE_BREAST_EXPOSED', 0.8)], r).verdict).toBe('reject');
    expect(decide(0.7, [...man, det('FEMALE_BREAST_EXPOSED', 0.8), det('MALE_GENITALIA_EXPOSED', 0.7)], r)).toMatchObject({ verdict: 'reject', reason: 'Detetado: genitais masculinos expostos (70%)' });
  });

  it('NSFW_AUTO_REJECT=false: o que seria recusado vai para a moderação', () => {
    expect(decide(0.9, [det('FEMALE_GENITALIA_EXPOSED', 0.95)], { ...r, autoReject: false }).verdict).toBe('review');
  });

  it('com NUDE_REJECT_MIN_NSFW, o classificador também tem de concordar', () => {
    expect(decide(0.35, [det('FEMALE_BREAST_EXPOSED', 0.9)], { ...r, rejectMinScore: 0.5 }).verdict).toBe('review');
  });

  it('detetor em baixo: nunca recusa; acima de 0.5 vai para a moderação', () => {
    expect(decide(0.99, 'failed', r)).toMatchObject({ verdict: 'review', reason: 'classificador 99% (detetor indisponível)' });
    expect(decide(0.4, 'failed', r).verdict).toBe('ok');
  });
});
