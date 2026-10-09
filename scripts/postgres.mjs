import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
function execute(file, args) {
  // Postgres inherits pg_ctl handles on Windows; pipes would keep execFile waiting.
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('pg_ctl failed; inspect server.log.')),
    );
  });
}
export async function createLocalPostgres({ directory, port }) {
  const databaseDir = resolve(directory);
  const embedded = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'local-development-only',
    port,
    persistent: true,
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {},
    onError: () => {},
  });
  if (!existsSync(join(databaseDir, 'PG_VERSION'))) await embedded.initialise();
  let pgCtl;
  if (process.platform === 'win32') {
    // pg_ctl uses a restricted Windows token; direct postgres.exe rejects administrators.
    ({ pg_ctl: pgCtl } = await import('@embedded-postgres/windows-x64'));
    await execute(pgCtl, [
      '-D',
      databaseDir,
      '-l',
      join(databaseDir, 'server.log'),
      '-o',
      `-p ${port} -h 127.0.0.1`,
      '-w',
      'start',
    ]);
  } else await embedded.start();
  return {
    url: `postgresql://postgres:local-development-only@127.0.0.1:${port}/postgres`,
    async stop() {
      if (pgCtl) await execute(pgCtl, ['-D', databaseDir, '-m', 'fast', '-w', 'stop']);
      else await embedded.stop();
    },
  };
}
