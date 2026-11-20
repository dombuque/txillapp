import { parseMusicLink, readMeta, safeCover, storedLink } from './music-link';

describe('música por ligação: reconhecer as plataformas (unidade)', () => {
  it('Spotify: música, álbum e playlist, com intl e rastreio; artista não', () => {
    expect(parseMusicLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123')).toMatchObject({ provider: 'spotify', linkKind: 'track', url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', embedUrl: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC' });
    expect(parseMusicLink('https://open.spotify.com/intl-pt/album/1A2GTWGtFfWp7KSQTwWOyo')).toMatchObject({ linkKind: 'album' });
    expect(parseMusicLink('https://open.spotify.com/artist/1A2GTWGtFfWp7KSQTwWOyo')).toBeNull();
  });

  it('YouTube: watch, youtu.be, shorts e music.youtube; o embed sem cookies', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ']) {
      expect(parseMusicLink(u)).toMatchObject({ provider: 'youtube', ref: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1' });
    }
    expect(parseMusicLink('https://www.youtube.com/watch?v=<script>')).toBeNull();
  });

  it('Audiomack, Boomplay, Deezer e Apple Music', () => {
    expect(parseMusicLink('https://audiomack.com/mr-bow/song/minha-musica')).toMatchObject({ provider: 'audiomack', linkKind: 'track', embedUrl: 'https://audiomack.com/embed/mr-bow/song/minha-musica' });
    expect(parseMusicLink('https://www.boomplay.com/songs/12345678?from=home')).toMatchObject({ provider: 'boomplay', linkKind: 'track', url: 'https://www.boomplay.com/songs/12345678', embedUrl: 'https://www.boomplay.com/embed/12345678/MUSIC' });
    expect(parseMusicLink('https://www.deezer.com/pt/track/3135556')).toMatchObject({ provider: 'deezer', url: 'https://www.deezer.com/track/3135556' });
    expect(parseMusicLink('https://music.apple.com/pt/album/nome/1440818839?i=1440818840')).toMatchObject({ provider: 'apple', linkKind: 'track', ref: '1440818840', embedUrl: 'https://embed.music.apple.com/pt/album/nome/1440818839?i=1440818840' });
  });

  it('outros sítios e lixo: recusados', () => {
    for (const u of ['https://evil.example/track/abc', 'javascript:alert(1)', 'nada', 'https://open.spotify.com.evil.example/track/abc', 'ftp://open.spotify.com/track/abc']) expect(parseMusicLink(u)).toBeNull();
  });

  it('a capa só das plataformas; sem metadados, «Música no Spotify»; o YouTube separa «Artista - Música»', () => {
    expect(safeCover('https://i.scdn.co/image/ab67616d0000b273')).toBe('https://i.scdn.co/image/ab67616d0000b273');
    expect(safeCover('https://evil.example/x.jpg')).toBeNull();
    expect(safeCover('http://i.scdn.co/image/x')).toBeNull();
    const sp = parseMusicLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')!;
    expect(storedLink(sp)).toMatchObject({ kind: 'link', title: 'Música no Spotify', url: '', link: sp.url, license: 'link' });
    const yt = parseMusicLink('https://youtu.be/dQw4w9WgXcQ')!;
    expect(storedLink(yt, readMeta(yt, { title: 'Mr Bow - Minha Mulher', author_name: '', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' }))).toMatchObject({ title: 'Minha Mulher', artist: 'Mr Bow', cover: 'https://i.ytimg.com/vi/x/hqdefault.jpg' });
    const ap = parseMusicLink('https://music.apple.com/pt/album/nome/1440818839?i=1440818840')!;
    expect(readMeta(ap, { results: [{ wrapperType: 'track', trackName: 'Canção', artistName: 'Artista', artworkUrl100: 'https://is1-ssl.mzstatic.com/a/100x100bb.jpg' }] })).toEqual({ title: 'Canção', artist: 'Artista', cover: 'https://is1-ssl.mzstatic.com/a/600x600bb.jpg' });
  });
});
