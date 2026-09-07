import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));

test('package versions agree and Project Record points to shipped facts', async () => {
  const version = (await readFile(join(root, 'VERSION'), 'utf8')).trim();
  const pkg = await json('package.json');
  const plugin = await json('.codex-plugin/plugin.json');
  const record = await json('.toolboxmd/project.json');
  assert.equal(pkg.version, version); assert.equal(plugin.version, version);
  assert.equal(plugin.name, 'codex-thinking-knob');
  assert.equal(record.id, plugin.name);
  assert.equal(record.kind, 'agent-module');
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(pkg.optionalDependencies ?? {}, {});
  assert.equal(plugin.mcpServers, undefined);
  assert.equal(plugin.apps, undefined);
  const paths = [record.factSources.version, ...Object.values(record.factSources.delivery),
    ...record.factSources.skills, ...record.factSources.documentation,
    ...record.factSources.requirements, ...record.factSources.proof];
  for (const path of paths) assert.ok((await readFile(join(root, path))).length, path);
});

test('packed artifact installs offline in an isolated prefix and contains only this module', { timeout: 30000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'thinking-knob-package-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const pack = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' }))[0];
  const paths = pack.files.map(f => f.path);
  for (const required of ['bin/codex-thinking-knob.mjs', 'src/bridge.mjs', '.codex-plugin/plugin.json',
    '.toolboxmd/project.json', 'skills/setup/SKILL.md', 'docs/runtime.md', 'VERSION']) assert.ok(paths.includes(required), required);
  assert.ok(paths.every(p => !/^(test|node_modules|\.git|\.github)\//.test(p)));
  const install = join(temporary, 'install');
  execFileSync('npm', ['install', '--prefix', install, '--ignore-scripts', '--offline', '--no-package-lock', '--no-audit', '--no-fund', join(temporary, pack.filename)], { encoding: 'utf8' });
  const modules = await readdir(join(install, 'node_modules'));
  assert.deepEqual(modules.filter(p => !p.startsWith('.')), ['@toolboxmd']);
  assert.deepEqual(await readdir(join(install, 'node_modules', '@toolboxmd')), ['codex-thinking-knob']);
  const installed = join(install, 'node_modules', '@toolboxmd', 'codex-thinking-knob');
  const version = (await readFile(join(root, 'VERSION'), 'utf8')).trim();
  assert.equal(execFileSync(process.execPath, [join(installed, 'bin/codex-thinking-knob.mjs'), '--version'], { encoding: 'utf8' }).trim(), version);
  assert.match(execFileSync(join(install, 'node_modules/.bin/codex-thinking-knob'), ['--help'], { encoding: 'utf8' }), /Usage:/);
});
