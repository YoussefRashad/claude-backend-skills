#!/usr/bin/env node
// Creates throwaway fixture repos for live Claude/Codex acceptance testing. Synthetic content only.
//
//   node tests/live/make-fixture.mjs --out <new or empty dir> [--kind fresh|v1|both] [--meta <dir>]
//
// Outputs
//   <out>/fixture-fresh, <out>/fixture-v1   git repos; the skill under test is copied to repo-level
//                                           .claude/skills and .agents/skills only (git-excluded)
//   <out>/.fixture-git/                     isolated git config, empty hooks dir, empty template dir
//   <out>/live-env.ps1, <out>/live-env.sh   env to load in every live-test terminal (same git isolation)
//   <meta> (default "<out>.meta")           fixture-meta.json + oracle/: which change is defective and the
//                                           executed proof. Kept OUTSIDE <out> so a session started in a
//                                           fixture does not see the expected answer.
//
// Git isolation: all inherited GIT_* variables are dropped; system config is ignored; global config is a
// generated file; hooks and templates point at empty directories; commit/tag signing is off; author and committer
// dates are fixed. The same settings are also written to each repo's local config.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i === -1 ? d : args[i + 1]; };
if (!opt('out')) { console.error('usage: make-fixture.mjs --out <dir> [--kind fresh|v1|both] [--meta <dir>]'); process.exit(1); }
const out = path.resolve(opt('out'));
const meta = path.resolve(opt('meta', `${out}.meta`));
const kind = opt('kind', 'both');
for (const d of [out, meta]) {
  if (fs.existsSync(d) && fs.readdirSync(d).length) { console.error(`refusing: ${d} is not empty`); process.exit(1); }
  fs.mkdirSync(d, { recursive: true });
}
const rel = path.relative(out, meta);
if (!rel.startsWith('..') && !path.isAbsolute(rel)) { console.error('refusing: --meta must be outside --out'); process.exit(1); }

// ---------------------------------------------------------------- git isolation
const G = path.join(out, '.fixture-git');
const HOOKS = path.join(G, 'hooks-empty');
const TEMPLATES = path.join(G, 'templates-empty');
fs.mkdirSync(HOOKS, { recursive: true });
fs.mkdirSync(TEMPLATES, { recursive: true });
const fwd = (p) => p.replace(/\\/g, '/');
const GITCONFIG = path.join(G, 'gitconfig');
fs.writeFileSync(GITCONFIG, [
  '[user]', '\tname = Fixture', '\temail = fixture@example.invalid',
  '[core]', '\tautocrlf = false', `\thooksPath = ${fwd(HOOKS)}`, '\tfsmonitor = false',
  '[commit]', '\tgpgsign = false', '[tag]', '\tgpgsign = false',
  '[init]', '\tdefaultBranch = main', `\ttemplateDir = ${fwd(TEMPLATES)}`, '',
].join('\n'));
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const GIT_ENV = { ...baseEnv, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GITCONFIG, GIT_TERMINAL_PROMPT: '0' };
const SAFE = ['-c', `core.hooksPath=${fwd(HOOKS)}`, '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.autocrlf=false'];
let clock = Date.UTC(2026, 0, 5, 9, 0, 0) / 1000;
function git(cwd, ...a) {
  const date = `${clock} +0000`;
  const r = spawnSync('git', [...SAFE, ...a], { cwd, encoding: 'utf8', windowsHide: true, env: { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
function commitAll(cwd, msg) { clock += 3600; git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', msg); return git(cwd, 'rev-parse', 'HEAD'); }

const put = (root, p, s) => { const f = path.join(root, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const INCLUDE = ['SKILL.md', 'VERSION', 'CHANGELOG.md', 'references', 'assets', 'data', 'scripts'];
const copySkill = (dest) => { for (const e of INCLUDE) fs.cpSync(path.join(SKILL, e), path.join(dest, e), { recursive: true }); };

// ---------------------------------------------------------------- fixture source
// Wallet ledger in erasable TypeScript (runs under Node type stripping; no decorators/enums/parameter properties).
const LEDGER_COMMON = `export interface BalanceStore {
  get(account: string): Promise<bigint>;
  set(account: string, balance: bigint): Promise<void>;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class InMemoryBalanceStore implements BalanceStore {
  balances: Map<string, bigint>;
  constructor(initial: Record<string, bigint>) {
    this.balances = new Map(Object.entries(initial));
  }
  async get(account: string): Promise<bigint> {
    await tick();
    return this.balances.get(account) ?? 0n;
  }
  async set(account: string, balance: bigint): Promise<void> {
    await tick();
    this.balances.set(account, balance);
  }
  snapshot(): Record<string, bigint> {
    return Object.fromEntries(this.balances);
  }
}

export class KeyedMutex {
  tails: Map<string, Promise<void>> = new Map();
  async runExclusive<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const releases: Array<() => void> = [];
    for (const key of [...new Set(keys)].sort()) releases.push(await this.acquire(key));
    try {
      return await fn();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }
  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    return () => {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }
}

export class InsufficientFundsError extends Error {
  constructor(account: string) {
    super(\`insufficient funds in \${account}\`);
    this.name = 'InsufficientFundsError';
  }
}
`;
const LEDGER_BASE = LEDGER_COMMON + `
export class WalletLedger {
  store: BalanceStore;
  locks: KeyedMutex;
  constructor(store: BalanceStore, locks: KeyedMutex = new KeyedMutex()) {
    this.store = store;
    this.locks = locks;
  }

  async transfer(from: string, to: string, amount: bigint): Promise<void> {
    if (amount <= 0n) throw new RangeError('amount must be positive');
    if (from === to) throw new RangeError('source and destination must differ');
    await this.locks.runExclusive([from, to], async () => {
      const fromBalance = await this.store.get(from);
      if (fromBalance < amount) throw new InsufficientFundsError(from);
      const toBalance = await this.store.get(to);
      await this.store.set(from, fromBalance - amount);
      await this.store.set(to, toBalance + amount);
    });
  }
}
`;
// Defective change: same API, the read-check-write sequence is no longer serialized.
const LEDGER_DEFECT = LEDGER_COMMON + `
export class WalletLedger {
  store: BalanceStore;
  locks: KeyedMutex;
  constructor(store: BalanceStore, locks: KeyedMutex = new KeyedMutex()) {
    this.store = store;
    this.locks = locks;
  }

  async transfer(from: string, to: string, amount: bigint): Promise<void> {
    if (amount <= 0n) throw new RangeError('amount must be positive');
    if (from === to) throw new RangeError('source and destination must differ');
    const [fromBalance, toBalance] = await Promise.all([this.store.get(from), this.store.get(to)]);
    if (fromBalance < amount) throw new InsufficientFundsError(from);
    await Promise.all([this.store.set(from, fromBalance - amount), this.store.set(to, toBalance + amount)]);
  }
}
`;
// Control change: behaviour-preserving refactor (validation extracted, lock kept).
const LEDGER_CONTROL = LEDGER_COMMON + `
export function validateTransfer(from: string, to: string, amount: bigint): void {
  if (amount <= 0n) throw new RangeError('amount must be positive');
  if (from === to) throw new RangeError('source and destination must differ');
}

export class WalletLedger {
  store: BalanceStore;
  locks: KeyedMutex;
  constructor(store: BalanceStore, locks: KeyedMutex = new KeyedMutex()) {
    this.store = store;
    this.locks = locks;
  }

  async transfer(from: string, to: string, amount: bigint): Promise<void> {
    validateTransfer(from, to, amount);
    await this.locks.runExclusive([from, to], async () => {
      const fromBalance = await this.store.get(from);
      if (fromBalance < amount) throw new InsufficientFundsError(from);
      const toBalance = await this.store.get(to);
      await this.store.set(from, fromBalance - amount);
      await this.store.set(to, toBalance + amount);
    });
  }
}
`;

function baseRepo(root) {
  put(root, 'package.json', JSON.stringify({
    name: 'fixture-wallet-api', private: true,
    scripts: { build: 'nest build', test: 'jest', lint: 'eslint "src/**/*.ts"', 'migration:run': 'typeorm migration:run -d src/data-source.ts' },
    dependencies: { '@nestjs/common': '^10.3.0', '@nestjs/core': '^10.3.0', '@nestjs/config': '^3.2.0', typeorm: '^0.3.20', pg: '^8.11.0', ioredis: '^5.3.2', joi: '^17.12.0' },
    devDependencies: { typescript: '^5.4.0', jest: '^29.7.0' },
  }, null, 2) + '\n');
  put(root, 'tsconfig.json', '{ "compilerOptions": { "target": "ES2022", "module": "commonjs", "strict": true, "outDir": "dist", "experimentalDecorators": true, "emitDecoratorMetadata": true } }\n');
  put(root, 'src/main.ts', "import { NestFactory } from '@nestjs/core';\nimport { AppModule } from './app.module';\n\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(process.env.PORT ?? 3000);\n}\nbootstrap();\n");
  put(root, 'src/app.module.ts', "import { Module } from '@nestjs/common';\nimport { ConfigModule } from '@nestjs/config';\nimport * as Joi from 'joi';\nimport { WalletModule } from './wallet/wallet.module';\n\n@Module({\n  imports: [\n    ConfigModule.forRoot({\n      validationSchema: Joi.object({\n        PORT: Joi.number().default(3000),\n        DATABASE_URL: Joi.string().required(),\n        REDIS_URL: Joi.string().required(),\n        JWT_SECRET: Joi.string().required(),\n      }),\n    }),\n    WalletModule,\n  ],\n})\nexport class AppModule {}\n");
  put(root, 'src/wallet/wallet.module.ts', "import { Module } from '@nestjs/common';\nimport { WalletController } from './wallet.controller';\nimport { WalletService } from './wallet.service';\n\n@Module({ providers: [WalletService], controllers: [WalletController] })\nexport class WalletModule {}\n");
  put(root, 'src/wallet/wallet.controller.ts', "import { Body, Controller, Post } from '@nestjs/common';\nimport { WalletService } from './wallet.service';\n\n@Controller({ path: 'wallets', version: '1' })\nexport class WalletController {\n  constructor(private readonly wallets: WalletService) {}\n\n  @Post('transfer')\n  transfer(@Body() body: { from: string; to: string; amount: string }) {\n    return this.wallets.transfer(body.from, body.to, BigInt(body.amount));\n  }\n}\n");
  put(root, 'src/wallet/wallet.service.ts', "import { Injectable } from '@nestjs/common';\nimport { InMemoryBalanceStore, WalletLedger } from './wallet.ledger';\n\n@Injectable()\nexport class WalletService {\n  private readonly ledger = new WalletLedger(new InMemoryBalanceStore({}));\n\n  async transfer(from: string, to: string, amount: bigint) {\n    await this.ledger.transfer(from, to, amount);\n    return { from, to, amount: amount.toString() };\n  }\n}\n");
  put(root, 'src/wallet/wallet.ledger.ts', LEDGER_BASE);
  put(root, '.env.example', 'PORT=3000\nDATABASE_URL=\nREDIS_URL=\n');
  put(root, '.gitignore', 'node_modules/\ndist/\n.env\n');
  put(root, '.env', 'DATABASE_URL=postgres://fixture:FIXTURE_ONLY_NOT_A_SECRET@localhost/db\nJWT_SECRET=FIXTURE_ONLY_NOT_A_SECRET\n');
}

function initRepo(root) {
  fs.mkdirSync(root);
  git(root, 'init', '-q', `--template=${TEMPLATES}`);
  for (const [k, v] of [['core.hooksPath', fwd(HOOKS)], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['core.autocrlf', 'false'], ['user.name', 'Fixture'], ['user.email', 'fixture@example.invalid']]) git(root, 'config', '--local', k, v);
}

// ---------------------------------------------------------------- oracle
// Executes the ledger at a given commit under real concurrency and checks the invariants a correct
// transfer must keep. It runs from <meta>/oracle, outside the fixture repo.
const ORACLE = `import { pathToFileURL } from 'node:url';
const file = process.argv[2];
const m = await import(pathToFileURL(file).href);
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const result = {};
// Scenario 1: two concurrent 60-unit transfers out of an account holding 100.
{
  const store = new m.InMemoryBalanceStore({ A: 100n, B: 0n, C: 0n });
  const ledger = new m.WalletLedger(store);
  const settled = await Promise.allSettled([ledger.transfer('A', 'B', 60n), ledger.transfer('A', 'C', 60n)]);
  const s = store.snapshot();
  const total = Object.values(s).reduce((a, b) => a + b, 0n);
  result.concurrentDebit = {
    fulfilled: settled.filter((x) => x.status === 'fulfilled').length,
    rejectedInsufficient: settled.filter((x) => x.status === 'rejected' && x.reason?.name === 'InsufficientFundsError').length,
    balances: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.toString()])),
    total: total.toString(),
  };
  result.conservesMoney = total === 100n;
  result.noOverdraft = result.concurrentDebit.fulfilled === 1 && result.concurrentDebit.rejectedInsufficient === 1;
}
// Scenario 2: opposite-direction transfers must not deadlock.
{
  const store = new m.InMemoryBalanceStore({ A: 50n, B: 50n });
  const ledger = new m.WalletLedger(store);
  try { await withTimeout(Promise.all([ledger.transfer('A', 'B', 10n), ledger.transfer('B', 'A', 20n)]), 2000); result.noDeadlock = true; }
  catch { result.noDeadlock = false; }
  const s = store.snapshot();
  result.crossTransferBalances = { A: s.A.toString(), B: s.B.toString() };
}
// Scenario 3: sequential behaviour is unchanged.
{
  const store = new m.InMemoryBalanceStore({ A: 100n, B: 0n });
  const ledger = new m.WalletLedger(store);
  await ledger.transfer('A', 'B', 30n);
  let rejected = false; try { await ledger.transfer('A', 'B', 0n); } catch { rejected = true; }
  result.sequentialOk = store.snapshot().A === 70n && store.snapshot().B === 30n && rejected;
}
result.correct = result.conservesMoney && result.noOverdraft && result.noDeadlock && result.sequentialOk;
process.stdout.write(JSON.stringify(result));
`;
const ORACLE_DIR = path.join(meta, 'oracle');
fs.mkdirSync(ORACLE_DIR);
fs.writeFileSync(path.join(ORACLE_DIR, 'run-oracle.mjs'), ORACLE);
function runOracle(repo, ref, label) {
  const src = git(repo, 'show', `${ref}:src/wallet/wallet.ledger.ts`);
  const file = path.join(ORACLE_DIR, `${label}.ledger.ts`);
  fs.writeFileSync(file, src + '\n');
  const attempt = (extra) => spawnSync(process.execPath, [...extra, path.join(ORACLE_DIR, 'run-oracle.mjs'), file], { encoding: 'utf8', windowsHide: true, env: baseEnv, timeout: 20000 });
  let r = attempt([]);
  if (r.status !== 0) r = attempt(['--experimental-strip-types']);
  if (r.status !== 0) throw new Error(`oracle failed for ${label} (Node ${process.version} needs TypeScript type stripping, Node >= 22.6): ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------- build
const made = [];
const metaOut = { skillVersion: fs.readFileSync(path.join(SKILL, 'VERSION'), 'utf8').trim(), node: process.version, fixtures: {} };
for (const k of kind === 'both' ? ['fresh', 'v1'] : [kind]) {
  const root = path.join(out, `fixture-${k}`);
  initRepo(root);
  baseRepo(root);
  if (k === 'v1') {
    put(root, 'CLAUDE.md', '# fixture-wallet-api\n<!-- Generated by project-setup · Source commit: 0000000 -->\n\n## Overview\nSee @.ai/context/project-tree.md\n\n## Team note\nKeep this hand-written section.\n');
    put(root, '.ai/context/project-tree.md', '# Project tree\n- src/wallet: money movement\n');
    put(root, '.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: v1 reviewer\ntools: Read, Grep, Glob, Bash\nmodel: opus\n---\nv1 reviewer prompt.\n');
    put(root, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(git status)'], deny: ['Read(.env)', 'Bash(DROP DATABASE *)'] }, hooks: { PostToolUse: [{ matcher: 'Write|Edit', command: 'npx eslint --fix "$CLAUDE_FILE_PATH" || true' }] } }, null, 2) + '\n');
    put(root, '.claudeignore', '.env\nnode_modules/\n');
  }
  const base = commitAll(root, `chore: initial ${k} fixture`);
  git(root, 'tag', 'fx-base');
  const entry = { path: root, base };
  if (k === 'fresh') {
    // Two candidate changes on separate branches from the same base. Which one is defective is random and
    // recorded only in the metadata. Commit messages and tag names are neutral.
    const defectiveSlot = randomInt(1, 3);
    const changes = {};
    for (const slot of [1, 2]) {
      git(root, 'checkout', '-q', '-b', `fx/change-${slot}`, 'fx-base');
      const defective = slot === defectiveSlot;
      put(root, 'src/wallet/wallet.ledger.ts', defective ? LEDGER_DEFECT : LEDGER_CONTROL);
      const sha = commitAll(root, defective ? 'refactor(wallet): read balances in parallel' : 'refactor(wallet): extract transfer validation');
      git(root, 'tag', `fx-change-${slot}`);
      changes[`change-${slot}`] = { sha, tag: `fx-change-${slot}`, range: `${base}..${sha}`, defective };
    }
    git(root, 'checkout', '-q', 'main');
    const oracle = { base: runOracle(root, 'fx-base', 'base') };
    for (const slot of [1, 2]) oracle[`change-${slot}`] = runOracle(root, `fx-change-${slot}`, `change-${slot}`);
    // The fixture is only valid if the oracle proves exactly what the metadata claims.
    const problems = [];
    if (!oracle.base.correct) problems.push('base ledger is not correct');
    for (const slot of [1, 2]) {
      const c = changes[`change-${slot}`]; const o = oracle[`change-${slot}`];
      if (c.defective && o.correct) problems.push(`change-${slot} should be defective but passed the oracle`);
      if (!c.defective && !o.correct) problems.push(`change-${slot} should be correct but failed the oracle`);
    }
    if (problems.length) throw new Error(`fixture self-check failed: ${problems.join('; ')}`);
    entry.changes = changes;
    entry.oracle = oracle;
    entry.expected = {
      defective: `change-${defectiveSlot}`,
      finding: 'Lost update / double spend in WalletLedger.transfer: balances are read and written without the per-account lock, so concurrent debits from one account both pass the funds check (oracle: two 60-unit transfers from 100 both succeed; total becomes 160).',
      file: 'src/wallet/wallet.ledger.ts',
      control: `change-${3 - defectiveSlot} must not be reported with a concurrency or money-integrity finding`,
    };
  }
  // Skill under test, repo-level only, git-excluded so the run's diffs stay readable.
  copySkill(path.join(root, '.claude', 'skills', 'project-setup'));
  copySkill(path.join(root, '.agents', 'skills', 'project-setup'));
  fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true }); // empty template => no info/ dir yet
  fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), '.claude/skills/\n.agents/skills/\n');
  // Self-check of the isolation.
  const hooksDir = path.join(root, '.git', 'hooks');
  const hooks = fs.existsSync(hooksDir) ? fs.readdirSync(hooksDir).filter((f) => !f.startsWith('.')) : [];
  entry.isolation = {
    hooksPath: git(root, 'config', '--get', 'core.hooksPath'),
    gpgsign: git(root, 'config', '--get', 'commit.gpgsign'),
    sampleHooksInGitDir: hooks.length,
    unsignedHead: !/^gpgsig /m.test(git(root, 'cat-file', '-p', 'HEAD')),
  };
  if (entry.isolation.sampleHooksInGitDir || !entry.isolation.unsignedHead || entry.isolation.gpgsign !== 'false') throw new Error(`git isolation self-check failed: ${JSON.stringify(entry.isolation)}`);
  metaOut.fixtures[k] = entry;
  made.push(root);
}
fs.writeFileSync(path.join(meta, 'fixture-meta.json'), JSON.stringify(metaOut, null, 2) + '\n');
// live-env scripts: FIRST remove every inherited GIT_* variable (GIT_DIR, GIT_WORK_TREE, GIT_CONFIG_COUNT/KEY_n/VALUE_n,
// GIT_CONFIG_PARAMETERS, GIT_EXEC_PATH, ...), THEN set the isolated values. Setting values alone is not isolation.
const psQuote = (v) => `'${String(v).replace(/'/g, "''")}'`;
const shQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
fs.writeFileSync(path.join(out, 'live-env.ps1'), [
  '# Dot-source in every live-test PowerShell terminal:  . <path>\\live-env.ps1',
  "@(Get-ChildItem Env: | Where-Object { $_.Name -like 'GIT_*' }) | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }",
  "$env:GIT_CONFIG_NOSYSTEM = '1'",
  `$env:GIT_CONFIG_GLOBAL = ${psQuote(GITCONFIG)}`,
  "$env:GIT_TERMINAL_PROMPT = '0'",
  '',
].join('\r\n'));
fs.writeFileSync(path.join(out, 'live-env.sh'), [
  '# Source in every live-test POSIX shell:  . <path>/live-env.sh',
  "for __ps_v in $(env | awk -F= '/^GIT_[A-Za-z0-9_]*=/{print $1}'); do unset \"$__ps_v\"; done; unset __ps_v",
  'export GIT_CONFIG_NOSYSTEM=1',
  `export GIT_CONFIG_GLOBAL=${shQuote(GITCONFIG)}`,
  'export GIT_TERMINAL_PROMPT=0',
  '',
].join('\n'));

const fresh = metaOut.fixtures.fresh;
console.log(JSON.stringify({
  ok: true,
  skillVersion: metaOut.skillVersion,
  fixtures: made,
  meta: path.join(meta, 'fixture-meta.json'),
  reviewRanges: fresh ? { 'change-1': fresh.changes['change-1'].range, 'change-2': fresh.changes['change-2'].range } : undefined,
  note: 'Which change is defective is in the meta file only. Do not open it from inside a live session.',
  next: 'Load live-env.ps1 / live-env.sh in each terminal, then follow tests/live/LIVE-ACCEPTANCE.md',
}, null, 2));
