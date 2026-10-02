/** Local filesystem transactions: exclusive lock, fresh read, fsync, atomic rename.
 * Locks are never expired by time: a slow live process still owns its reservation.
 * A crash leaves an explicit recoverable lock instead of silently admitting spend.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { invalidState } from '../util/errors.js';

export async function atomicJson(target: string, value: unknown): Promise<void> {
  const temp = `${target}.tmp-${randomUUID()}`;
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temp, target);
    try {
      const directory = await fs.open(path.dirname(target), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      // Windows does not support opening/syncing a directory. Other errors fail closed.
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  } finally { await fs.rm(temp, { force: true }); }
}

export async function withTransaction<T>(target: string, action: () => Promise<T>): Promise<T> {
  const lock = `${target}.lock`;
  const deadline = Date.now() + 10_000;
  for (;;) {
    let handle;
    try { handle = await fs.open(lock, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw invalidState('Storage transaction is locked; inspect and recover a stopped worker before retrying', { lock });
      await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30));
      continue;
    }
    try {
      await handle.writeFile(JSON.stringify({ schema: 'game_dev.lock.v1', pid: process.pid, host: os.hostname(), token: randomUUID(), createdAt: new Date().toISOString() }));
      await handle.sync();
      return await action();
    } finally { await handle.close(); await fs.rm(lock, { force: true }); }
  }
}

/** Explicit recovery only, and only for a provably dead process on this host.
 * Never authorize provider replay: this recovers storage ownership, not billing state.
 */
export async function recoverTransactionLock(target: string, confirm: boolean): Promise<void> {
  if (!confirm) throw invalidState('Lock recovery requires explicit confirmation');
  const lock = `${target}.lock`;
  // Serialize recovery operators; normal transactions cannot replace the old lock until unlink.
  const recovery = await fs.open(`${lock}.recovery`, 'wx', 0o600);
  try {
    const raw = await fs.readFile(lock, 'utf8');
    const owner = JSON.parse(raw) as { schema?: string; pid?: number; host?: string };
    if (owner.schema !== 'game_dev.lock.v1' || owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || (owner.pid ?? 0) <= 0) {
      throw invalidState('Cannot prove lock ownership; preserve evidence and recover manually while all workers are stopped');
    }
    try { process.kill(owner.pid!, 0); throw invalidState('Lock owner is still alive; refusing recovery'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    if (await fs.readFile(lock, 'utf8') !== raw) throw invalidState('Lock changed during recovery');
    await fs.unlink(lock);
  } finally { await recovery.close(); await fs.rm(`${lock}.recovery`, { force: true }); }
}
