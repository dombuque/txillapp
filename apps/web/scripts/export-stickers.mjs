// Gera os stickers em SVG (texto) para a app nativa, a partir do desenho do site: npm run export-stickers
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const tmp = resolve('node_modules/.cache/export-stickers.mjs');
await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { STICKERS, STICKER_CATS, Sticker } from './src/lib/stickers';
      export const data = {
        cats: STICKER_CATS,
        items: STICKERS.map((s) => ({ id: s.id, cat: s.cat, text: s.text, svg: renderToStaticMarkup(React.createElement(Sticker, { id: s.id, size: 132, bare: true })).replace(/fontFamily="inherit"|font-family="inherit"/g, 'font-family="sans-serif"').replace(/ class="[^"]*"/g, '') })),
      };`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
  platform: 'node',
  format: 'esm',
  outfile: tmp,
  jsx: 'automatic',
  banner: { js: "globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }; globalThis.window ??= globalThis; globalThis.document ??= { documentElement: {} }; try { globalThis.navigator ??= { language: 'pt-MZ', languages: ['pt-MZ'] }; } catch {}" },
  logLevel: 'error',
});
const { data } = await import(pathToFileURL(tmp).href);
const out = resolve('../mobile/src/assets/stickers.json');
mkdirSync(resolve('../mobile/src/assets'), { recursive: true });
writeFileSync(out, JSON.stringify(data));
console.log(`${data.items.length} stickers em ${data.cats.length} categorias -> ${out}`);
