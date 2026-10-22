import { PlacesService } from './places.service';

describe('PlacesService (fetch simulado)', () => {
  const urls: string[] = [];
  const bodies: string[] = [];

  beforeEach(() => {
    urls.length = 0;
    bodies.length = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('nominatim')) {
        return new Response(JSON.stringify({ address: { suburb: 'Bairro do Fomento', city: 'Maputo' } }));
      }
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          elements: [
            { lat: -25.9661, lon: 32.5741, tags: { name: 'Bar Longe', amenity: 'bar' } },
            { lat: -25.9651, lon: 32.5731, tags: { name: 'Praia da Barra', natural: 'beach' } },
            { lat: -25.9652, lon: 32.5732, tags: { name: 'praia da barra', natural: 'beach' } },
            { center: { lat: -25.9650, lon: 32.5730 }, tags: { leisure: 'park' } },
          ],
        }),
      );
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('arredonda as coordenadas antes de sair para o serviço externo (sem GPS exacto)', async () => {
    await new PlacesService().nearby(-25.96512345, 32.57309876);
    expect(urls[0]).toContain('lat=-25.965&lon=32.573');
    expect(urls[0]).not.toContain('96512345');
    expect(decodeURIComponent(bodies[0])).not.toContain('96512345');
  });

  it('devolve bairro, cidade e sítios ordenados por distância, sem duplicados nem sem nome', async () => {
    const r = await new PlacesService().nearby(-25.965, 32.573);
    expect(r.area).toBe('Bairro do Fomento');
    expect(r.city).toBe('Maputo');
    expect(r.places.map((p) => p.name)).toEqual(['Praia da Barra', 'Bar Longe']);
    expect(r.places[0].kind).toBe('praia');
    expect(r.places[0].distanceM).toBeLessThan(r.places[1].distanceM);
  });

  it('se o serviço externo falhar, responde vazio em vez de rebentar', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('rede em baixo'));
    await expect(new PlacesService().nearby(1.234, 2.345)).resolves.toEqual({ area: null, city: null, places: [] });
  });
});
