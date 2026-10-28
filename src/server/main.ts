/** Start the REST API with a file-backed SQLite database. */
import { Repository } from '../db/repository.js';
import { createApi } from './api.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? './data.db';

const repo = new Repository(dbPath);
const server = createApi(repo);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`trade-journal API listening on http://localhost:${port} (db: ${dbPath})`);
});

const shutdown = (): void => {
  server.close(() => {
    repo.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
