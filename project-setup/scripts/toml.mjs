// Strict TOML 1.0 parser for validation. Zero dependencies.
// Supports everything except date/time values, which are reported as `unsupported` (and treated as a failure by
// callers, never as a pass). Any construct it cannot parse is an error. Returns { data, errors, unsupported }.
// Errors stop parsing at the first problem (like reference parsers).

class TomlError extends Error {}
class TomlUnsupported extends Error {}

const BARE = /[A-Za-z0-9_-]/;
const DIGIT = /[0-9]/;

export function parseToml(input) {
  const src = String(input);
  let pos = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const root = {};
  const meta = new WeakMap(); // table -> 'implicit' | 'explicit' | 'dotted' | 'inline' | 'aot'
  const aot = new WeakSet();  // arrays created by [[...]]
  meta.set(root, 'explicit');

  const line = () => src.slice(0, pos).split('\n').length;
  const err = (m) => { throw new TomlError(`line ${line()}: ${m}`); };
  const peek = (n = 0) => src[pos + n];
  const startsWith = (s) => src.startsWith(s, pos);

  function checkCtl(ch, allowNewline) {
    const c = ch.charCodeAt(0);
    if (ch === '\t') return;
    if (allowNewline && (ch === '\n')) return;
    if (c < 0x20 || c === 0x7f) err(`control character U+${c.toString(16).padStart(4, '0')} not allowed`);
  }
  function ws() { while (peek() === ' ' || peek() === '\t') pos++; }
  function comment() {
    if (peek() !== '#') return;
    pos++;
    while (pos < src.length && peek() !== '\n' && !startsWith('\r\n')) { checkCtl(peek(), false); pos++; }
  }
  function newline() {
    if (startsWith('\r\n')) { pos += 2; return true; }
    if (peek() === '\n') { pos++; return true; }
    if (peek() === '\r') err('bare carriage return');
    return false;
  }
  function endOfLine() {
    ws(); comment();
    if (pos >= src.length) return;
    if (!newline()) err(`unexpected "${peek()}"`);
  }

  function escape(allowLineEnding) {
    pos++; // backslash
    const c = peek();
    const simple = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
    if (c in simple) { pos++; return simple[c]; }
    if (c === 'u' || c === 'U') {
      const len = c === 'u' ? 4 : 8;
      const hex = src.slice(pos + 1, pos + 1 + len);
      if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) err(`invalid \\${c} escape`);
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) err('escape is not a Unicode scalar value');
      pos += 1 + len;
      return String.fromCodePoint(cp);
    }
    if (allowLineEnding) {
      // line-ending backslash: optional whitespace, newline, then trim all whitespace/newlines
      let p = pos;
      while (src[p] === ' ' || src[p] === '\t') p++;
      if (src[p] === '\n' || src.startsWith('\r\n', p)) {
        pos = p;
        while (pos < src.length && (peek() === ' ' || peek() === '\t' || peek() === '\n' || startsWith('\r\n'))) pos += startsWith('\r\n') ? 2 : 1;
        return '';
      }
    }
    err(`invalid escape sequence "\\${c ?? ''}"`);
  }

  function basicString() {
    pos++; let out = '';
    for (;;) {
      if (pos >= src.length) err('unterminated string');
      const c = peek();
      if (c === '"') { pos++; return out; }
      if (c === '\n' || c === '\r') err('newline in basic string');
      if (c === '\\') { out += escape(false); continue; }
      checkCtl(c, false); out += c; pos++;
    }
  }
  function literalString() {
    pos++; let out = '';
    for (;;) {
      if (pos >= src.length) err('unterminated literal string');
      const c = peek();
      if (c === "'") { pos++; return out; }
      if (c === '\n' || c === '\r') err('newline in literal string');
      checkCtl(c, false); out += c; pos++;
    }
  }
  function multiline(q, basic) {
    pos += 3;
    newline(); // a newline right after the opening delimiter is trimmed
    let out = '';
    for (;;) {
      if (pos >= src.length) err('unterminated multi-line string');
      if (startsWith(q)) {
        // A run of 3..5 quote characters closes the string; 1-2 leading ones belong to the content.
        let n = 0;
        while (src[pos + n] === q[0]) n++;
        if (n > 5) err('too many consecutive quotes in multi-line string');
        out += q[0].repeat(n - 3); pos += n; return out;
      }
      const c = peek();
      if (startsWith('\r\n')) { out += '\n'; pos += 2; continue; }
      if (c === '\r') err('bare carriage return');
      if (basic && c === '\\') { out += escape(true); continue; }
      checkCtl(c, true); out += c; pos++;
    }
  }

  function key() {
    const parts = [];
    for (;;) {
      ws();
      const c = peek();
      if (c === '"') parts.push(startsWith('"""') ? err('multi-line string cannot be a key') : basicString());
      else if (c === "'") parts.push(startsWith("'''") ? err('multi-line string cannot be a key') : literalString());
      else {
        const s = pos;
        while (pos < src.length && BARE.test(peek())) pos++;
        if (pos === s) err('expected a key');
        parts.push(src.slice(s, pos));
      }
      ws();
      if (peek() === '.') { pos++; continue; }
      return parts;
    }
  }

  const NUM_END = /[\s,\]}#]/;
  function numberOrDate() {
    const rest = src.slice(pos);
    if (/^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}/.test(rest)) throw new TomlUnsupported(`line ${line()}: date/time values are not supported by this validator`);
    const pats = [
      [/^[+-]?(inf|nan)/, (m) => (m[0].endsWith('nan') ? NaN : (m[0][0] === '-' ? -Infinity : Infinity))],
      [/^0x[0-9A-Fa-f](_?[0-9A-Fa-f])*/, (m) => parseInt(m[0].slice(2).replace(/_/g, ''), 16)],
      [/^0o[0-7](_?[0-7])*/, (m) => parseInt(m[0].slice(2).replace(/_/g, ''), 8)],
      [/^0b[01](_?[01])*/, (m) => parseInt(m[0].slice(2).replace(/_/g, ''), 2)],
      [/^[+-]?(0|[1-9](_?[0-9])*)(\.[0-9](_?[0-9])*)?([eE][+-]?[0-9](_?[0-9])*)?/, (m) => Number(m[0].replace(/_/g, ''))],
    ];
    for (const [re, conv] of pats) {
      const m = rest.match(re);
      if (m && (m[0].length === rest.length || NUM_END.test(rest[m[0].length]))) { pos += m[0].length; return conv(m); }
    }
    err('invalid value');
  }

  function array() {
    pos++; const out = [];
    const skip = () => { for (;;) { ws(); comment(); if (!newline()) break; } };
    for (;;) {
      skip();
      if (peek() === ']') { pos++; return out; }
      out.push(value());
      skip();
      if (peek() === ',') { pos++; continue; }
      if (peek() === ']') { pos++; return out; }
      err('expected "," or "]" in array');
    }
  }
  function inlineTable() {
    pos++; const t = {}; meta.set(t, 'inline');
    ws();
    if (peek() === '}') { pos++; return t; }
    for (;;) {
      const k = key();
      if (peek() !== '=') err('expected "=" in inline table');
      pos++; ws();
      assign(t, k, value(), true);
      ws();
      if (peek() === ',') { pos++; ws(); if (peek() === '}') err('trailing comma in inline table'); continue; }
      if (peek() === '}') { pos++; return t; }
      err('expected "," or "}" in inline table');
    }
  }
  function value() {
    const c = peek();
    if (startsWith('"""')) return multiline('"""', true);
    if (startsWith("'''")) return multiline("'''", false);
    if (c === '"') return basicString();
    if (c === "'") return literalString();
    if (startsWith('true') && (pos + 4 >= src.length || NUM_END.test(src[pos + 4]))) { pos += 4; return true; }
    if (startsWith('false') && (pos + 5 >= src.length || NUM_END.test(src[pos + 5]))) { pos += 5; return false; }
    if (c === '[') return array();
    if (c === '{') return inlineTable();
    if (c !== undefined && (DIGIT.test(c) || c === '+' || c === '-' || c === 'i' || c === 'n')) return numberOrDate();
    err('expected a value');
  }

  const isTable = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  function assign(table, parts, val, inInline) {
    let t = table;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!(p in t)) { const n = {}; meta.set(n, inInline ? 'inline' : 'dotted'); t[p] = n; t = n; continue; }
      const next = t[p];
      if (!isTable(next)) err(`key "${parts.slice(0, i + 1).join('.')}" is not a table`);
      const k = meta.get(next);
      if (k === 'inline' && !inInline) err(`inline table "${p}" cannot be extended`);
      if (k === 'explicit' || k === 'implicit' || k === 'aot') err(`table "${parts.slice(0, i + 1).join('.')}" was defined by a header; dotted keys cannot extend it`);
      t = next;
    }
    const last = parts[parts.length - 1];
    if (last in t) err(`duplicate key "${parts.join('.')}"`);
    t[last] = val;
  }

  function header(isArray) {
    pos += isArray ? 2 : 1;
    const parts = key();
    if (isArray) { if (!startsWith(']]')) err('expected "]]"'); pos += 2; } else { if (peek() !== ']') err('expected "]"'); pos++; }
    let t = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]; const last = i === parts.length - 1;
      if (last && isArray) {
        if (!(p in t)) { const arr = []; aot.add(arr); t[p] = arr; }
        const arr = t[p];
        if (!Array.isArray(arr) || !aot.has(arr)) err(`"${parts.join('.')}" is not an array of tables`);
        const n = {}; meta.set(n, 'aot'); arr.push(n); return n;
      }
      if (!(p in t)) { const n = {}; meta.set(n, last ? 'explicit' : 'implicit'); t[p] = n; t = n; continue; }
      let next = t[p];
      if (Array.isArray(next)) {
        if (!aot.has(next)) err(`"${parts.slice(0, i + 1).join('.')}" is a static array`);
        if (last) err(`"${parts.join('.')}" is an array of tables`);
        t = next[next.length - 1]; continue;
      }
      if (!isTable(next)) err(`"${parts.slice(0, i + 1).join('.')}" is not a table`);
      const k = meta.get(next);
      if (k === 'inline') err(`inline table "${p}" cannot be extended`);
      if (last) {
        if (k === 'explicit' || k === 'dotted' || k === 'aot') err(`table [${parts.join('.')}] defined more than once`);
        meta.set(next, 'explicit');
      }
      t = next;
    }
    return t;
  }

  let current = root;
  try {
    for (;;) {
      for (;;) { ws(); comment(); if (!newline()) break; }
      if (pos >= src.length) break;
      if (startsWith('[[')) { current = header(true); endOfLine(); continue; }
      if (peek() === '[') { current = header(false); endOfLine(); continue; }
      const k = key();
      if (peek() !== '=') err('expected "=" after key');
      pos++; ws();
      assign(current, k, value(), false);
      endOfLine();
    }
  } catch (e) {
    if (e instanceof TomlError) return { data: null, errors: [e.message], unsupported: [] };
    if (e instanceof TomlUnsupported) return { data: null, errors: [], unsupported: [e.message] };
    throw e;
  }
  return { data: root, errors: [], unsupported: [] };
}
