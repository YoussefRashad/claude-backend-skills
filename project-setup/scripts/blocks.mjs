#!/usr/bin/env node
// Managed blocks: the only regions of a mixed-ownership text file the skill may rewrite.
// Everything outside the markers belongs to the user.
//
//   Markdown:   <!-- project-setup:begin id=security -->  ...  <!-- project-setup:end id=security -->
//   #-comment:  # project-setup:begin id=gitignore        ...  # project-setup:end id=gitignore
//
// JSON files have no comments; they use key-level merges instead (merge-claude-settings.mjs).
//
// CLI:
//   node blocks.mjs check  --file <repo-rel>
//   node blocks.mjs hashes --file <repo-rel>
//   node blocks.mjs drift  --file <repo-rel>              (compare against .ai/manifest.json)
//   node blocks.mjs upsert --file <repo-rel> --id <id> --content <path> --run-id <id> [--style md|hash]
//        writes the merged result to .ai/.run/<run-id>/drafts/<repo-rel>; never touches the target.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, repoRoot, safeResolve, normalizeText, normalizedHash, detectEol,
  loadSecretSpec, isSecretPath, readJsonFile, ok, fail, validateRunId, secureDir, writeInRepo, readInRepo, assertNotSecretInput,
} from './lib.mjs';

const MARKER = /^\s*(?:<!--\s*|#\s*)project-setup:(begin|end)\s+id=([A-Za-z0-9._-]+)\s*(?:-->)?\s*$/;

export function styleFor(relPath) {
  return /\.(md|markdown)$/i.test(relPath) ? 'md' : 'hash';
}

export function markers(id, style) {
  return style === 'md'
    ? [`<!-- project-setup:begin id=${id} -->`, `<!-- project-setup:end id=${id} -->`]
    : [`# project-setup:begin id=${id}`, `# project-setup:end id=${id}`];
}

export function parseBlocks(text) {
  const lines = normalizeText(text).split('\n');
  const blocks = [];
  const errors = [];
  const seen = new Set();
  let open = null;
  let inFence = false;
  lines.forEach((line, i) => {
    // Markers inside fenced code are documentation, not structure.
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = line.match(MARKER);
    if (!m) return;
    const [, kind, id] = m;
    if (kind === 'begin') {
      if (open) errors.push(`line ${i + 1}: begin id=${id} while id=${open.id} is still open (nesting is not allowed)`);
      else if (seen.has(id)) errors.push(`line ${i + 1}: duplicate block id=${id}`);
      else open = { id, startLine: i };
    } else {
      if (!open) errors.push(`line ${i + 1}: end id=${id} without matching begin`);
      else if (open.id !== id) errors.push(`line ${i + 1}: end id=${id} does not match open id=${open.id}`);
      else {
        blocks.push({ id, startLine: open.startLine, endLine: i, inner: lines.slice(open.startLine + 1, i).join('\n') });
        seen.add(id);
        open = null;
      }
    }
  });
  if (open) errors.push(`block id=${open.id} opened at line ${open.startLine + 1} is never closed`);
  return { blocks, errors, lines };
}

/**
 * Everything the user owns in a block-managed file: lines outside managed blocks, with each block
 * collapsed to a placeholder carrying its id (so removing or reordering blocks also counts as a change).
 */
export function outsideContent(text) {
  const { blocks, errors, lines } = parseBlocks(text ?? '');
  if (errors.length) return { errors, outside: null, ids: [] };
  const out = [];
  let i = 0;
  for (const b of blocks) {
    out.push(...lines.slice(i, b.startLine), `<<project-setup block ${b.id}>>`);
    i = b.endLine + 1;
  }
  out.push(...lines.slice(i));
  return { errors: [], outside: out.join('\n'), ids: blocks.map((b) => b.id) };
}

export function blockHashes(text) {
  const { blocks, errors } = parseBlocks(text);
  const hashes = {};
  for (const b of blocks) hashes[b.id] = normalizedHash(b.inner);
  return { hashes, errors };
}

/** Replace (or append) one managed block. Returns text using the original EOL style. */
export function upsertBlock(text, id, inner, style) {
  const original = text ?? '';
  const eol = original ? detectEol(original) : '\n';
  const { blocks, errors, lines } = parseBlocks(original);
  if (errors.length) throw new Error(`refusing to edit a file with broken markers:\n${errors.join('\n')}`);
  const [begin, end] = markers(id, style);
  const body = normalizeText(inner).replace(/\n$/, '').split('\n');
  const existing = blocks.find((b) => b.id === id);
  let out;
  if (existing) {
    out = [...lines.slice(0, existing.startLine + 1), ...body, ...lines.slice(existing.endLine)];
  } else {
    const base = original ? lines.slice() : [];
    while (base.length && base[base.length - 1] === '') base.pop();
    out = [...base, ...(base.length ? [''] : []), begin, ...body, end];
  }
  let result = out.join('\n');
  if (!result.endsWith('\n')) result += '\n';
  return eol === '\r\n' ? result.replace(/\n/g, '\r\n') : result;
}

// ---------------------------------------------------------------- CLI ----
const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const isMain = Boolean(process.argv[1]) && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const root = repoRoot();
  if (!root) fail('not inside a git repository');
  if (!args.file || args.file === true) fail('--file is required');
  const spec = loadSecretSpec();
  const { abs, rel } = safeResolve(root, String(args.file));
  if (isSecretPath(rel, spec)) fail(`refusing to read a secret-pattern path: ${rel}`);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;

  if (cmd === 'check') {
    const { blocks, errors } = parseBlocks(current ?? '');
    ok({ file: rel, exists: current !== null, blocks: blocks.map((b) => b.id), errors });
  } else if (cmd === 'hashes') {
    ok({ file: rel, ...blockHashes(current ?? '') });
  } else if (cmd === 'drift') {
    const mpath = path.join(root, '.ai', 'manifest.json');
    if (!fs.existsSync(mpath)) fail('no .ai/manifest.json; drift needs a v2 install');
    const entry = readJsonFile(mpath).files?.[rel];
    if (!entry) { ok({ file: rel, managed: false }); }
    else if (current === null) { ok({ file: rel, managed: true, deleted: true }); }
    else if (entry.ownership === 'full') {
      const now = normalizedHash(current);
      ok({ file: rel, ownership: 'full', userModified: now !== entry.sha256 });
    } else if (entry.ownership === 'blocks') {
      const { hashes, errors } = blockHashes(current);
      const report = Object.entries(entry.blocks || {}).map(([id, sha]) => ({
        id, state: hashes[id] === undefined ? 'removed-by-user' : hashes[id] === sha ? 'unchanged' : 'edited-by-user',
      }));
      ok({ file: rel, ownership: 'blocks', markerErrors: errors, blocks: report });
    } else ok({ file: rel, ownership: entry.ownership, note: 'use the merge script report for key-level ownership' });
  } else if (cmd === 'upsert') {
    for (const k of ['id', 'content', 'run-id']) if (!args[k] || args[k] === true) fail(`--${k} is required`);
    let runId;
    try { runId = validateRunId(args['run-id']); } catch (e) { fail(e.message); }
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(args.id))) fail('invalid block id');
    const style = args.style || styleFor(rel);
    let contentPath;
    try { contentPath = assertNotSecretInput(args.content, spec); } catch (e) { fail(e.message, 2); }
    const inner = fs.readFileSync(contentPath, 'utf8');
    let result;
    try { result = upsertBlock(current, String(args.id), inner, style); } catch (e) { fail(e.message, 3); }
    let draftsRoot;
    try { draftsRoot = secureDir(root, ['.ai', '.run', runId, 'drafts']); } catch (e) { fail(e.message, 2); }
    if (!draftsRoot) fail('run not initialised; run apply.mjs init first');
    const draftRel = `.ai/.run/${runId}/drafts/${rel}`;
    // If a draft already exists (several blocks in one file), build on it. Paths re-validated from the repo root.
    let existingDraft = null;
    try { existingDraft = readInRepo(root, draftRel).toString('utf8'); } catch (e) { if (e.code !== 'ENOENT' && !/directory missing/.test(e.message)) fail(e.message, 2); }
    if (existingDraft !== null) {
      try { result = upsertBlock(existingDraft, String(args.id), inner, style); } catch (e) { fail(e.message, 3); }
    }
    try { writeInRepo(root, draftRel, result); } catch (e) { fail(e.message, 2); }
    const draftPath = path.join(root, draftRel);
    ok({ file: rel, draft: path.relative(root, draftPath).split(path.sep).join('/'), block: String(args.id) });
  } else {
    fail('usage: blocks.mjs check|hashes|drift|upsert --file <path>');
  }
}
