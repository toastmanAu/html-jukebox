import { describe, expect, it } from 'vitest';
import { inspectHTML } from '../src/player/portability';
const document = (imports: unknown, code: string) => `<script type="importmap">${JSON.stringify({ imports })}</script><script type="module">${code}</script>`;
const mappings = { three: 'https://cdn.example/three/build/three.module.js', 'three/addons/': 'https://cdn.example/three/examples/jsm/' };
describe('import-map portability', () => {
  it('resolves Three.js and all reported addon imports while retaining dynamic fetch review', () => {
    const source = document(mappings, `import * as THREE from 'three';\n${['controls/OrbitControls.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js'].map(path => `import x from 'three/addons/${path}';`).join('\n')}\nfetch(endpoint);`);
    const report = inspectHTML(source);
    expect(report.acceptable).toBe(true);
    expect(report.issues).toEqual([{ kind: 'dynamic', source: 'script', value: 'fetch(endpoint' }]);
    expect(report.externalUrls).toContain('https://cdn.example/three/examples/jsm/postprocessing/OutputPass.js');
  });
  it('uses exact mappings before the longest prefix', () => {
    const report = inspectHTML(document({ 'pkg/': 'https://cdn.example/root/', 'pkg/sub/': 'https://cdn.example/sub/', 'pkg/sub/exact.js': 'https://cdn.example/exact.js' }, `import 'pkg/sub/exact.js'; import('pkg/sub/other.js');`));
    expect(report.acceptable).toBe(true);
    expect(report.externalUrls).toContain('https://cdn.example/sub/other.js');
    expect(report.externalUrls).not.toContain('https://cdn.example/root/sub/other.js');
  });
  it('does not apply import maps to fetch, worker, or image paths', () => {
    const report = inspectHTML(document(mappings, `fetch('three'); new Worker('three');`) + '<img src="three">');
    expect(report.acceptable).toBe(false);
    expect(report.issues.filter(i => i.kind === 'relative')).toHaveLength(2);
  });
  it.each([{}, { three: './three.js' }, { three: 'http://cdn.example/three.js' }, { three: null }, { 'three/addons/': 'https://cdn.example/addons' }])('blocks unresolved or invalid mapping %j', map => {
    expect(inspectHTML(document(map, `import 'three'; import 'three/addons/controls.js';`)).acceptable).toBe(false);
  });
  it('blocks prefix traversal and malformed maps', () => {
    expect(inspectHTML(document(mappings, `import 'three/addons/../escape.js';`)).acceptable).toBe(false);
    expect(inspectHTML('<script type="importmap">not JSON</script>').acceptable).toBe(false);
  });
  it('does not retroactively apply maps declared after a module', () => {
    expect(inspectHTML(`<script type="module">import 'three';</script>` + document(mappings, '')).acceptable).toBe(false);
  });
  it('does not activate an import map inside an inert template', () => {
    expect(inspectHTML('<template>' + document(mappings, '') + `</template><script type="module">import 'three';</script>`).acceptable).toBe(false);
  });
  it('keeps variable resource expressions as review items', () => {
    expect(inspectHTML(document(mappings, 'import(`three/addons/${name}`)')).issues.some(i => i.kind === 'dynamic')).toBe(true);
  });
});
