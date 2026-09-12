/* This static page has no imports from the app and receives no wallet or transaction objects. */
(() => {
  const hostOrigin = new URL(document.URL).origin;
  const session = new URL(document.URL).searchParams.get('session');
  if (parent === window || !session) return;
  const frame = document.getElementById('demo');
  let loaded = false;
  window.addEventListener('message', event => {
    if (loaded || event.source !== parent || event.origin !== hostOrigin || event.data?.type !== 'ckbfs-launch' || event.data.session !== session) return;
    const { html, pointerLock, allow } = event.data;
    if (typeof html !== 'string' || typeof pointerLock !== 'boolean' || typeof allow !== 'string') return;
    loaded = true;
    frame.setAttribute('sandbox', pointerLock ? 'allow-scripts allow-pointer-lock' : 'allow-scripts');
    frame.setAttribute('allow', allow);
    frame.srcdoc = html;
  });
  parent.postMessage({ type: 'ckbfs-sandbox-ready', session }, hostOrigin);
})();
