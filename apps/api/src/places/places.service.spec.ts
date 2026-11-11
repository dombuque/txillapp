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

describe('PlacesService: pesquisa com posição e reverso (fetch simulado)', () => {
  const urls: string[] = [];
  const feature = (props: Record<string, string>, coordinates?: unknown) => ({ type: 'Feature', properties: props, ...(coordinates === undefined ? {} : { geometry: { type: 'Point', coordinates } }) });
  let photon: unknown[] = [];
  let nominatim: unknown = {};

  beforeEach(() => {
    urls.length = 0;
    photon = [];
    nominatim = {};
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      return new Response(JSON.stringify(url.includes('nominatim') ? nominatim : { features: photon }));
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('cada sugestão traz a posição ([lng, lat] do Photon), a rua e número e a cidade; sem posição válida fica de fora', async () => {
    photon = [
      feature({ name: 'Bar Pinguim', osm_key: 'amenity', osm_value: 'bar', street: 'Av. Julius Nyerere', housenumber: '123', district: 'Polana', city: 'Maputo', country: 'Mozambique', countrycode: 'MZ' }, [32.5995123, -25.9654321]),
      feature({ name: 'Sem geometria', osm_key: 'amenity', osm_value: 'bar', countrycode: 'MZ' }),
      feature({ name: 'Fora do mundo', osm_key: 'amenity', osm_value: 'bar', countrycode: 'MZ' }, [200, -95]),
      feature({ name: 'Texto em vez de número', countrycode: 'MZ' }, ['32.5', '-25.9']),
      feature({ name: 'Matola', osm_key: 'place', osm_value: 'city', type: 'city', country: 'Mozambique', countrycode: 'MZ' }, [32.4589, -25.9622]),
      feature({ name: 'Costa do Sol', osm_key: 'place', osm_value: 'suburb', street: 'Av. da Marginal', city: 'Maputo', countrycode: 'MZ' }, [32.646, -25.894]),
    ];
    const r = await new PlacesService().search('bar', -25.96512345, 32.57309876);
    expect(r).toEqual([
      { name: 'Bar Pinguim', sub: 'Polana, Maputo, Mozambique', kind: 'bar', lat: -25.9654321, lng: 32.5995123, address: 'Av. Julius Nyerere 123', city: 'Maputo' },
      { name: 'Matola', sub: 'Mozambique', kind: 'local', lat: -25.9622, lng: 32.4589, address: null, city: 'Matola' },
      { name: 'Costa do Sol', sub: 'Maputo', kind: 'local', lat: -25.894, lng: 32.646, address: 'Av. da Marginal', city: 'Maputo' },
    ]);
    // Com a posição de quem procura: vai arredondada (~110 m) e sem o viés de Moçambique.
    expect(urls[0]).toContain('lat=-25.965&lon=32.573');
    expect(urls[0]).toContain('limit=7');
    expect(urls[0]).not.toContain('96512345');
    expect(urls[0]).not.toContain('zoom=');
  });

  it('sem posição de quem procura, puxa para Moçambique e põe os de Moçambique primeiro (até 7)', async () => {
    photon = [
      feature({ name: 'Costa do Sol', city: 'Cidreira', country: 'Brazil', countrycode: 'BR' }, [-50.23, -30.21]),
      feature({ name: 'Costa do Sol', city: 'Maputo', country: 'Mozambique', countrycode: 'MZ' }, [32.646, -25.894]),
      ...Array.from({ length: 8 }, (_, i) => feature({ name: `Costa ${i}`, city: `Cidade ${i}`, countrycode: 'PT' }, [-9 + i / 10, 38.7])),
    ];
    const r = await new PlacesService().search('costa do sol');
    expect(urls[0]).toContain('lat=-18.7&lon=35.5&zoom=5');
    expect(urls[0]).toContain('limit=10');
    expect(r).toHaveLength(7);
    expect(r[0]).toMatchObject({ name: 'Costa do Sol', city: 'Maputo' });
    expect(r[1]).toMatchObject({ name: 'Costa do Sol', city: 'Cidreira' });
  });

  it('a pesquisa fica em cache (o mesmo texto não volta a sair)', async () => {
    photon = [feature({ name: 'Mercado do Peixe', countrycode: 'MZ' }, [32.62, -25.95])];
    const s = new PlacesService();
    await s.search('mercado do peixe');
    await s.search('Mercado do Peixe');
    expect(urls).toHaveLength(1);
  });

  it('reverso: nome do sítio, rua e número e cidade, com a posição arredondada (~11 m) antes de sair; fica em cache', async () => {
    nominatim = { name: 'Bar Pinguim', address: { road: 'Av. Julius Nyerere', house_number: '123', suburb: 'Polana', city: 'Maputo' } };
    const s = new PlacesService();
    const r = await s.reverseAddress(-25.96543219, 32.59951234);
    expect(r).toEqual({ name: 'Bar Pinguim', address: 'Av. Julius Nyerere 123', city: 'Maputo' });
    expect(urls[0]).toContain('nominatim');
    expect(urls[0]).toContain('lat=-25.9654&lon=32.5995');
    expect(urls[0]).not.toContain('96543219');
    await s.reverseAddress(-25.96541, 32.59949); // a mesma quadrícula de ~11 m
    expect(urls).toHaveLength(1);
  });

  it('reverso: sem sítio com nome (ou com o nome igual à rua) o nome vem a null; sem rua, a morada também', async () => {
    nominatim = { name: 'Rua da Sé', address: { road: 'Rua da Sé', town: 'Inhambane' } };
    expect(await new PlacesService().reverseAddress(-23.865, 35.383)).toEqual({ name: null, address: 'Rua da Sé', city: 'Inhambane' });
    nominatim = { name: '', address: { neighbourhood: 'Central "C"', city: 'Cidade de Maputo' } };
    expect(await new PlacesService().reverseAddress(-25.9692, 32.5732)).toEqual({ name: null, address: null, city: 'Cidade de Maputo' });
  });

  it('reverso: se o serviço externo falhar, vem tudo a null em vez de rebentar', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('rede em baixo'));
    await expect(new PlacesService().reverseAddress(1.234, 2.345)).resolves.toEqual({ name: null, address: null, city: null });
  });
});
