#!/usr/bin/env node
// The only code path that opens an env template. It returns key NAMES and value
// CLASSIFICATIONS, never values. Agents use this instead of reading .env.* files.
// It never opens `.env` itself (only *.example / *.sample / *.template).
//
// Usage:
//   node env-keys.mjs keys  --file .env.example
//   node env-keys.mjs merge --file .env.example --keys <keys.json> --run-id <id>
//     keys.json: [{ "name": "DB_HOST", "required": true, "secret": false, "description": "...", "group": "Database" }]
//     Writes the merged file to .ai/.run/<id>/vault/files/<file> (covered by the secret deny list).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, repoRoot, safeResolve, detectEol, ok, fail, validateRunId, secureDir, writeInRepo, ENV_TEMPLATE_RE, assertNotSecretInput } from './lib.mjs';
import { upsertBlock, parseBlocks } from './blocks.mjs';

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const root = repoRoot();
if (!root) fail('not inside a git repository');
const fileArg = args.file && args.file !== true ? String(args.file) : '.env.example';
if (!ENV_TEMPLATE_RE.test(fileArg.replace(/\\/g, '/'))) fail('only .env.example/.env.sample/.env.template are supported; .env is never opened');
const { abs, rel } = safeResolve(root, fileArg);

const SECRETISH = /(SECRET|TOKEN|PASSWORD|PASSWD|PASS$|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY|_KEY$|DSN|SALT|SIGNING|CERT)/i;
const PLACEHOLDER = /^(|<[^>]*>|changeme|change_me|xxx+|your[_-].*|example.*|placeholder|todo|redacted|\*+|""|'')$/i;

function parse(text) {
  const entries = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/);
    if (!m) return;
    const [, name, rawValue] = m;
    const value = rawValue.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    let state;
    if (PLACEHOLDER.test(value)) state = value === '' ? 'empty' : 'placeholder';
    else if (SECRETISH.test(name) || /:\/\/[^/\s]*:[^@\s]+@/.test(value)) state = 'possible-real-secret';
    else state = 'non-placeholder';
    entries.push({ name, line: i + 1, valueState: state });
  });
  return entries;
}

const exists = fs.existsSync(abs);
const text = exists ? fs.readFileSync(abs, 'utf8') : '';
const entries = parse(text);

if (cmd === 'keys') {
  ok({ file: rel, exists, keys: entries, possibleRealSecrets: entries.filter((e) => e.valueState === 'possible-real-secret').map((e) => e.name) });
} else if (cmd === 'merge') {
  let runId;
  try { runId = validateRunId(args['run-id']); } catch (e) { fail(e.message); }
  const keysPath = args.keys && args.keys !== true ? path.resolve(String(args.keys)) : fail('--keys is required');
  let keysReal;
  try { keysReal = assertNotSecretInput(keysPath); } catch (e) { fail(e.message, 2); }
  let wanted;
  try { wanted = JSON.parse(fs.readFileSync(keysReal, 'utf8')); } catch { fail('--keys is not valid JSON (content not shown)', 3); }
  if (!Array.isArray(wanted)) fail('--keys must be a JSON array');
  const have = new Set(entries.map((e) => e.name));
  const missing = wanted.filter((k) => k && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(k.name) && !have.has(k.name));
  if (!missing.length) { ok({ file: rel, changed: false, added: [] }); process.exit(0); }
  const groups = new Map();
  for (const k of missing) {
    const g = k.group || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(k);
  }
  const body = [];
  for (const [g, ks] of groups) {
    body.push(`# --- ${g} ---`);
    for (const k of ks) {
      const tags = [k.required ? 'required' : 'optional', k.secret ? 'secret' : 'non-secret'].join(', ');
      body.push(`# ${String(k.description || '').replace(/[\r\n]+/g, ' ')} (${tags})`.replace('#  (', '# ('));
      body.push(`${k.name}=${k.secret ? '<REDACTED>' : ''}`);
    }
  }
  // Append to an existing managed block instead of replacing it (keys added by earlier runs must survive).
  const prior = parseBlocks(text).blocks.find((b) => b.id === 'env-example');
  const inner = prior ? `${prior.inner.replace(/\n+$/, '')}\n${body.join('\n')}` : body.join('\n');
  let merged = upsertBlock(text, 'env-example', inner, 'hash');
  if (exists && detectEol(text) === '\r\n') merged = merged.replace(/\r?\n/g, '\r\n');
  try {
    if (!secureDir(root, ['.ai', '.run', runId, 'vault', 'files'])) fail('run not initialised; run apply.mjs init first');
    writeInRepo(root, `.ai/.run/${runId}/vault/files/${rel}`, merged);
  } catch (e) { fail(e.message, 2); }
  ok({ file: rel, changed: true, added: missing.map((k) => k.name), existingPossibleRealSecrets: entries.filter((e) => e.valueState === 'possible-real-secret').map((e) => e.name) });
} else {
  fail('usage: env-keys.mjs keys|merge --file .env.example');
}
