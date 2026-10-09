// Structural validators used by validate.mjs. Zero dependencies.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrArr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const RULE = /^[A-Za-z_*][\w*-]*(\(.*\))?$/s;

/**
 * Shape checks for .claude/settings.json. Returns [{ level, msg }].
 * fail: problems in keys this skill manages or depends on (permissions.*), which would break its controls.
 * warn: problems in user-owned keys (hooks, env, $schema). They are reported, never "fixed", and they do not make
 *       the setup invalid: e.g. a legacy hook the user chose to keep is not executed, which the user must know.
 */
export function checkClaudeSettings(s) {
  const out = [];
  const fail = (msg) => out.push({ level: 'fail', msg });
  const warn = (msg) => out.push({ level: 'warn', msg });
  if (!isObj(s)) { fail('root must be an object'); return out; }
  if ('$schema' in s && typeof s.$schema !== 'string') warn('$schema must be a string');
  if ('permissions' in s) {
    const p = s.permissions;
    if (!isObj(p)) fail('permissions must be an object');
    else {
      for (const k of ['allow', 'deny', 'ask', 'additionalDirectories']) {
        if (k in p && !isStrArr(p[k])) fail(`permissions.${k} must be an array of strings`);
      }
      for (const k of ['allow', 'deny', 'ask']) {
        if (isStrArr(p[k])) p[k].forEach((r, i) => { if (!RULE.test(r)) fail(`permissions.${k}[${i}] is not a valid rule: ${r}`); });
      }
      if ('defaultMode' in p && typeof p.defaultMode !== 'string') fail('permissions.defaultMode must be a string');
    }
  }
  if ('hooks' in s) {
    if (!isObj(s.hooks)) warn('hooks must be an object');
    else for (const [ev, list] of Object.entries(s.hooks)) {
      if (!Array.isArray(list)) { warn(`hooks.${ev} must be an array`); continue; }
      list.forEach((h, i) => {
        if (!isObj(h)) { warn(`hooks.${ev}[${i}] must be an object`); return; }
        if ('matcher' in h && typeof h.matcher !== 'string') warn(`hooks.${ev}[${i}].matcher must be a string`);
        if (!Array.isArray(h.hooks)) { warn(`hooks.${ev}[${i}] has no hooks[] array (legacy shape is never executed)`); return; }
        h.hooks.forEach((x, j) => {
          if (!isObj(x) || typeof x.type !== 'string') warn(`hooks.${ev}[${i}].hooks[${j}].type must be a string`);
          else if (x.type === 'command' && typeof x.command !== 'string') warn(`hooks.${ev}[${i}].hooks[${j}].command must be a string`);
        });
      });
    }
  }
  if ('env' in s && (!isObj(s.env) || !Object.values(s.env).every((v) => typeof v === 'string'))) warn('env must be an object of strings');
  return out;
}

const HEX64 = /^[0-9a-f]{64}$/;
export function checkManifest(m) {
  const errs = [];
  if (!isObj(m)) return ['root must be an object'];
  if (m.schema !== 2) errs.push('schema must be 2');
  if (m.skill !== 'project-setup') errs.push('skill must be "project-setup"');
  if (typeof m.skillVersion !== 'string') errs.push('skillVersion must be a string');
  if (!isStrArr(m.agents)) errs.push('agents must be an array of strings');
  if (!isObj(m.files)) return [...errs, 'files must be an object'];
  for (const [f, e] of Object.entries(m.files)) {
    if (!isObj(e)) { errs.push(`files["${f}"] must be an object`); continue; }
    switch (e.ownership) {
      case 'full': if (!HEX64.test(e.sha256 || '')) errs.push(`files["${f}"].sha256 must be a sha256 hex`); break;
      case 'blocks': if (!isObj(e.blocks) || !Object.values(e.blocks).every((h) => HEX64.test(h))) errs.push(`files["${f}"].blocks must map ids to sha256 hex`); break;
      case 'keys': if (!isObj(e.managed)) errs.push(`files["${f}"].managed must be an object`); break;
      case 'merged': break;
      default: errs.push(`files["${f}"].ownership is invalid: ${e.ownership}`);
    }
  }
  return errs;
}
