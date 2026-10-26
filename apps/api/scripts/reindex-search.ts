// Reconstrói o índice do Elasticsearch a partir do PostgreSQL: npm run search:reindex -w @txillapp/api
// (precisa de SEARCH_BACKEND=elasticsearch e ELASTICSEARCH_URL no .env)
import 'dotenv/config';
import { Client } from '@elastic/elasticsearch';
import { Pool } from 'pg';
import { loadConfig } from '../src/config';
import { SearchIndexer } from '../src/search/search-index';

(async () => {
  const config = loadConfig();
  if (config.SEARCH_BACKEND !== 'elasticsearch') throw new Error('Define SEARCH_BACKEND=elasticsearch e ELASTICSEARCH_URL.');
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const client = new Client({ node: config.ELASTICSEARCH_URL!, ...(config.ELASTICSEARCH_API_KEY ? { auth: { apiKey: config.ELASTICSEARCH_API_KEY } } : {}) });
  const n = await new SearchIndexer(pool, config, client).reindexAll();
  console.log(`Indexados ${n} documentos (publicações e pessoas).`);
  await pool.end();
  await client.close();
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
