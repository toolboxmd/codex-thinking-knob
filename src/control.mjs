import { createServer } from 'node:net';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Private per-process endpoint; no global listener, credentials or daemon. */
export async function createControl(setEffort) {
  const directory = await mkdtemp(join(tmpdir(), 'knob-'));
  await chmod(directory, 0o700);
  const socket = join(directory, 'control.sock'), token = randomBytes(32).toString('hex');
  const clients = new Set();
  const server = createServer(client => {
    clients.add(client); client.once('close', () => clients.delete(client));
    client.on('error', () => {}); client.setTimeout(15_000, () => client.destroy());
    let data = '', used = false;
    client.setEncoding('utf8');
    client.on('data', async chunk => {
      if (used) return;
      data += chunk;
      if (Buffer.byteLength(data) > 65536) { used = true; client.destroy(); return; }
      if (!data.includes('\n')) return;
      used = true;
      let response;
      try {
        const request = JSON.parse(data.slice(0, data.indexOf('\n')));
        const candidate = Buffer.from(typeof request.token === 'string' ? request.token : '');
        if (candidate.length !== token.length || !timingSafeEqual(candidate, Buffer.from(token))) throw new Error('Unauthorized');
        response = await setEffort(request);
      } catch { response = { status: 'rejected', executionVerified: false }; }
      if (!client.destroyed) client.end(JSON.stringify(response) + '\n');
    });
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
    await chmod(socket, 0o600);
  } catch (error) { server.close(); await rm(directory, { recursive: true, force: true }); throw error; }
  return { socket, token, async close() {
    for (const client of clients) client.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  } };
}
