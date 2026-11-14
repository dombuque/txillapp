import { sourceFps, to30fps } from './video.service';

// A conversão do envio a 30 fps certos (media/video.service.ts): cada frame com o frame da fonte mais perto (docs/montagem.md, 6-A).
describe('to30fps', () => {
  it('lê os fps da fonte (a média, senão a nominal; fora de 5 a 240, 30)', () => {
    expect(sourceFps('60/1', '60/1')).toBe(60);
    expect(sourceFps('14400/239', '120/1')).toBeCloseTo(60.25);
    expect(sourceFps('0/0', '30000/1001')).toBeCloseTo(29.97);
    expect(sourceFps('0/0', '90000/1')).toBe(30);
    expect(sourceFps(undefined, undefined)).toBe(30);
  });
  it('adianta os tempos meia diferença entre os intervalos (a fronteira do `fps` fica entre dois frames da fonte)', () => {
    expect(to30fps(30)).toBe('fps=30');
    expect(to30fps(29.97)).toBe('fps=30');
    expect(to30fps(60)).toBe('setpts=PTS+0.008333/TB,fps=30');
    expect(to30fps(120)).toBe('setpts=PTS+0.012500/TB,fps=30');
    expect(to30fps(24)).toBe('setpts=PTS-0.004167/TB,fps=30');
  });
});
