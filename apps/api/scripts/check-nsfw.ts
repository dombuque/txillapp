// Descarrega o modelo (1.ª vez) e analisa as imagens dadas: npx ts-node scripts/check-nsfw.ts foto1.jpg foto2.png
import { readFileSync } from 'fs';
import { extname } from 'path';
import { LocalNsfwClassifier } from '../src/moderation/image-moderation.service';

const mimeOf = (f: string) => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } as Record<string, string>)[extname(f).toLowerCase()] ?? 'image/jpeg';

(async () => {
  const c = new LocalNsfwClassifier(process.env.MODEL_CACHE_DIR ?? './.models', process.env.NSFW_MODEL ?? 'AdamCodd/vit-base-nsfw-detector');
  for (const f of process.argv.slice(2)) {
    const t = Date.now();
    const score = await c.nsfwScore(readFileSync(f), mimeOf(f));
    console.log(`${f}: nsfw=${(score * 100).toFixed(1)}%  (${Date.now() - t} ms)`);
  }
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
