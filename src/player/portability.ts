import { parse, type DefaultTreeAdapterMap } from 'parse5';
export interface PortabilityIssue { kind: 'relative' | 'insecure' | 'base' | 'dynamic'; source: string; value: string }
export interface PortabilityReport { issues: PortabilityIssue[]; externalUrls: string[]; acceptable: boolean }
/** Parses a detached syntax tree. Unlike DOM insertion this cannot execute scripts or fetch images. */
export function inspectHTML(source: string): PortabilityReport {
  const issues: PortabilityIssue[] = []; const externalUrls = new Set<string>(); const seen = new Set<string>();
  function issue(kind: PortabilityIssue['kind'], context: string, value: string) {
    const key = `${kind}:${context}:${value}`; if (!seen.has(key)) { seen.add(key); issues.push({ kind, source: context, value }); }
  }
  function url(value: string, context: string) {
    const text = value.trim(); if (!text || text.startsWith('#') || /^(data:|blob:)/i.test(text)) return;
    if (/^https:\/\//i.test(text)) { externalUrls.add(text); return; }
    issue(/^[\w+.-]+:|^\/\//.test(text) ? 'insecure' : 'relative', context, text);
  }
  function code(text: string, context: string) {
    for (const m of text.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?["']([^"']+)["']/g)) url(m[1], `${context} module import`);
    for (const m of text.matchAll(/\b(?:import|fetch|Worker|SharedWorker|importScripts)\s*\(\s*(["'`])([^"'`]+)\1/g)) url(m[2], `${context} resource call`);
    for (const m of text.matchAll(/\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["']([^"']+)["']/gi)) url(m[1], `${context} XHR`);
    for (const m of text.matchAll(/\.load(?:Async)?\s*\(\s*["']([^"']+)["']/g)) url(m[1], `${context} loader`);
    for (const m of text.matchAll(/\bnew\s+URL\s*\(\s*["']([^"']+)["']/g)) url(m[1], `${context} URL`);
    for (const m of text.matchAll(/\b(?:import|fetch|Worker|SharedWorker)\s*\(\s*([^\s"'`][^,)\n]*)/g)) issue('dynamic', context, m[0]);
  }
  function css(text: string, context: string) {
    for (const m of text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) url(m[2], `${context} CSS url`);
    for (const m of text.matchAll(/@import\s+["']([^"']+)["']/gi)) url(m[1], `${context} CSS import`);
  }
  function walk(node: DefaultTreeAdapterMap['node']) {
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
          try { const map = JSON.parse(text); for (const target of Object.values(map.imports ?? {})) if (typeof target === 'string') url(target, 'import map'); }
          catch { issue('dynamic', 'import map', 'Invalid import map JSON'); }
        } else code(text, 'script');
      }
      if (el.tagName === 'style') css(text, 'stylesheet');
      if ('content' in el && el.content && typeof el.content === 'object') walk(el.content as DefaultTreeAdapterMap['node']);
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child);
  }
  walk(parse(source));
  return { issues, externalUrls: [...externalUrls], acceptable: !issues.some(i => i.kind !== 'dynamic') };
}
