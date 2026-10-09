import { createLocalPostgres } from './postgres.mjs';
const pg = await createLocalPostgres({
  directory: '.local-postgres',
  port: Number(process.env.LOCAL_PG_PORT || 55432),
});
console.log('Local PostgreSQL running on 127.0.0.1:' + (process.env.LOCAL_PG_PORT || 55432));
console.log(
  'Use DATABASE_URL=postgresql://postgres:local-development-only@127.0.0.1:' +
    (process.env.LOCAL_PG_PORT || 55432) +
    '/postgres',
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 60000);
