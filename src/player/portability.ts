import { parse, type DefaultTreeAdapterMap } from 'parse5';
export interface PortabilityIssue { kind: 'relative' | 'insecure' | 'base' | 'dynamic' | 'importmap'; source: string; value: string }
export interface PortabilityReport { issues: PortabilityIssue[]; externalUrls: string[]; acceptable: boolean }
/** Parses a detached syntax tree. Unlike DOM insertion this cannot execute scripts or fetch images. */
export function inspectHTML(source: string): PortabilityReport {
  const issues: PortabilityIssue[] = []; const externalUrls = new Set<string>(); const seen = new Set<string>();
  const imports = new Map<string, string | null>();
  function issue(kind: PortabilityIssue['kind'], context: string, value: string) {
    const key = `${kind}:${context}:${value}`; if (!seen.has(key)) { seen.add(key); issues.push({ kind, source: context, value }); }
  }
  function url(value: string, context: string) {
    const text = value.trim(); if (!text || text.startsWith('#') || /^(data:|blob:)/i.test(text)) return;
    if (/^https:\/\//i.test(text)) { externalUrls.add(text); return; }
    issue(/^[\w+.-]+:|^\/\//.test(text) ? 'insecure' : 'relative', context, text);
  }
  function moduleUrl(specifier: string, context: string) {
    const key = imports.has(specifier) ? specifier : [...imports.keys()].filter(key => key.endsWith('/') && specifier.startsWith(key)).sort((a, b) => b.length - a.length)[0];
    if (key === undefined) { url(specifier, context); return; }
    const target = imports.get(key);
    if (!target) { issue('importmap', context, `Blocked or invalid mapping: ${specifier}`); return; }
    if (key === specifier) { url(target, context); return; }
    try {
      const resolved = new URL(specifier.slice(key.length), target).href;
      if (!resolved.startsWith(target)) { issue('importmap', context, `Import escapes its mapped prefix: ${specifier}`); return; }
      url(resolved, context);
    } catch { issue('importmap', context, `Invalid prefix mapping: ${specifier}`); }
  }
  function importMap(text: string) {
    try {
      const map = JSON.parse(text);
      if (!map || typeof map !== 'object' || Array.isArray(map) || (map.imports !== undefined && (!map.imports || typeof map.imports !== 'object' || Array.isArray(map.imports)))) throw Error();
      for (const [key, target] of Object.entries(map.imports ?? {})) {
        if (!key) { issue('importmap', 'import map', 'Empty module specifier'); continue; }
        if (imports.has(key)) continue; // Earlier maps take precedence.
        let normalized: string | null = null;
        if (typeof target === 'string') {
          url(target, 'import map');
          try { const address = new URL(target); if (['https:', 'data:', 'blob:'].includes(address.protocol) && (!key.endsWith('/') || address.href.endsWith('/'))) normalized = address.href; } catch { /* Report invalid mapping below. */ }
        }
        imports.set(key, normalized);
        if (target !== null && !normalized) issue('importmap', 'import map', `Invalid target for ${key}: ${String(target)}`);
      }
      if (map.scopes) {
        issue('dynamic', 'import map scopes', 'Review scoped module mappings and test them in the production preview.');
        for (const scope of Object.values(map.scopes)) if (scope && typeof scope === 'object') for (const target of Object.values(scope)) if (typeof target === 'string') url(target, 'import map scope');
      }
    } catch { issue('importmap', 'import map', 'Invalid import map JSON or imports object'); }
  }
  function code(text: string, context: string) {
    for (const m of text.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?["']([^"']+)["']/g)) moduleUrl(m[1], `${context} module import`);
    for (const m of text.matchAll(/\b(import|fetch|Worker|SharedWorker|importScripts)\s*\(\s*(["'`])([^"'`]+)\2/g)) {
      if (m[3].includes('${')) issue('dynamic', context, m[0]);
      else if (m[1] === 'import') moduleUrl(m[3], `${context} module import`);
      else url(m[3], `${context} resource call`);
    }
    for (const m of text.matchAll(/\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["']([^"']+)["']/gi)) url(m[1], `${context} XHR`);
    for (const m of text.matchAll(/\.load(?:Async)?\s*\(\s*["']([^"']+)["']/g)) url(m[1], `${context} loader`);
    for (const m of text.matchAll(/\bnew\s+URL\s*\(\s*["']([^"']+)["']/g)) url(m[1], `${context} URL`);
    for (const m of text.matchAll(/\b(?:import|fetch|Worker|SharedWorker)\s*\(\s*([^\s"'`][^,)\n]*)/g)) issue('dynamic', context, m[0]);
  }
  function css(text: string, context: string) {
    for (const m of text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) url(m[2], `${context} CSS url`);
    for (const m of text.matchAll(/@import\s+["']([^"']+)["']/gi)) url(m[1], `${context} CSS import`);
  }
  function walk(node: DefaultTreeAdapterMap['node'], inert = false) {
    if ('tagName' in node) {
      const el = node as DefaultTreeAdapterMap['element']; const attrs = Object.fromEntries(el.attrs.map(a => [a.name, a.value]));
      if (el.tagName === 'base') issue('base', '<base>', attrs.href ?? 'base element');
      for (const attr of ['src', 'poster', 'data', 'xlink:href']) if (attrs[attr]) url(attrs[attr], `<${el.tagName} ${attr}>`);
      if (attrs.href && ['link', 'use', 'image'].includes(el.tagName)) url(attrs.href, `<${el.tagName} href>`);
      if (attrs.srcset) for (const entry of attrs.srcset.split(/,\s*(?=[^,]+(?:\s+\d+[wx])?(?:,|$))/)) url(entry.trim().split(/\s+/)[0], `<${el.tagName} srcset>`);
      if (attrs.style) css(attrs.style, 'inline style');
      const text = el.childNodes.filter(n => n.nodeName === '#text').map(n => (n as DefaultTreeAdapterMap['textNode']).value).join('');
      if (el.tagName === 'script') {
        if (attrs.type === 'importmap') {
          if (!inert) importMap(text);
        } else code(text, 'script');
      }
      if (el.tagName === 'style') css(text, 'stylesheet');
      if ('content' in el && el.content && typeof el.content === 'object') walk(el.content as DefaultTreeAdapterMap['node'], true);
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child, inert);
  }
  walk(parse(source));
  return { issues, externalUrls: [...externalUrls], acceptable: !issues.some(i => i.kind !== 'dynamic') };
}
