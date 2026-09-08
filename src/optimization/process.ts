import { spawn } from 'node:child_process';
import { registerOwnedProcessTerminator } from '../util/process-lifecycle.js';

/** Literal arguments, bounded output, process-group cancellation, no provider environment. */
export function runCommand(executable: string, args: string[], cwd: string, timeoutSeconds = 120, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Operation cancelled')); return; }
    const child = spawn(executable, args, { cwd, shell: false, detached: process.platform !== 'win32',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let error: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const kill = (sig: 'SIGTERM' | 'SIGKILL') => {
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig); else child.kill(sig); } catch { /* exited */ }
    };
    const terminate = (reason: string) => { error ??= new Error(reason); kill('SIGTERM'); killTimer ??= setTimeout(() => kill('SIGKILL'), 500); };
    const unregister = registerOwnedProcessTerminator(kill);
    const timer = setTimeout(() => terminate('Command timed out'), timeoutSeconds * 1000);
    const abort = () => terminate('Operation cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    const receive = (bytes: Buffer) => {
      if (Buffer.byteLength(output) + bytes.length > 8 * 1024 * 1024) terminate('Command output exceeds 8 MiB');
      else output += bytes.toString('utf8');
    };
    child.stdout.on('data', receive);
    // Preserve stdout as a machine-readable stream for git. Drain stderr separately.
    let stderr = '';
    child.stderr.on('data', (bytes: Buffer) => {
      if (Buffer.byteLength(stderr) + bytes.length > 1024 * 1024) terminate('Command diagnostics exceed 1 MiB');
      else stderr += bytes.toString('utf8');
    });
    const cleanup = () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); unregister(); signal?.removeEventListener('abort', abort); kill('SIGKILL'); };
    child.on('error', (reason) => { cleanup(); reject(reason); });
    child.on('exit', (code) => {
      // A descendant holding a pipe must not keep this operation alive.
      setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); }, 100).unref();
      if (code !== 0) error ??= new Error(`Command exited ${code}: ${stderr.slice(-4000)}`);
    });
    child.on('close', () => { cleanup(); if (error) reject(error); else resolve(output); });
  });
}
