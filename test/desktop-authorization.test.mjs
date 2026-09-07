import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const resources = process.env.KNOB_DESKTOP_RESOURCES;
test('desktop entrypoint preserves real native MCP peer authorization', {
  skip: !resources && 'Requires an explicitly isolated macOS desktop installation',
  timeout: 60000,
}, async t => {
  assert.equal(process.platform, 'darwin');
  const temporary = await mkdtemp(join(tmpdir(), 'knob-authorization-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  // The signed runner is part of the checked process ancestry. The fixture
  // owns its servers, provider, profiles and pipe. It cannot contact the app.
  const output = execFileSync(join(resources, 'cua_node/bin/node'), [
    fileURLToPath(new URL('./fixtures/desktop-authorization.mjs', import.meta.url)),
  ], {
    env: { PATH: '/usr/bin:/bin', KNOB_DESKTOP_RESOURCES: resources,
      KNOB_TEST_ROOT: temporary },
    encoding: 'utf8', timeout: 50000,
  });
  const cases = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(cases.length, 2);
  for (const item of cases) {
    assert.ok(item.checks.length > 0, `${item.name}: native authorization was not exercised`);
    assert.ok(item.checks.every(check => check.authorized), JSON.stringify(item));
    assert.equal(item.outcome.requestCount, 1);
    assert.deepEqual(item.outcome.completed, ['completed']);
  }
});
