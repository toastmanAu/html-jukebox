# Demo Player Security

Treat all stored HTML/JavaScript as isolated content.

## Isolation rule

Never inject demo markup into the launcher DOM.

Use a dedicated iframe generated from the verified bytes.

Baseline candidate:

```html
sandbox="allow-scripts allow-pointer-lock allow-downloads"
```

Do not add `allow-same-origin` by default.

## Capabilities

Manifest:

```ts
type DemoCapabilities = {
  network: boolean;
  audio: boolean;
  fullscreen: boolean;
  pointerLock: boolean;
  geolocation: boolean;
  clipboard: boolean;
};
```

Build iframe `sandbox` and `allow` policy from approved capabilities.

Do not globally grant:
- geolocation
- clipboard
- camera
- microphone

## Host player chrome

Keep outside the iframe:
- Back to Jukebox
- demo title
- reload
- fullscreen
- cached/verified indicator
- optional metadata button

The demo cannot remove the host toolbar.

## Portability scanner

Parse source without executing it.

Detect/warn for relative:
- `<script src>`
- stylesheet links
- image/audio/video/model URLs
- module imports
- CSS `url(...)`
- `fetch("./...")`
- XHR
- Worker paths
- obvious GLTFLoader/TextureLoader calls

Initial acceptance:
- single-file self-contained HTML; or
- absolute external HTTPS resources.

Relative filesystem dependencies are not CKBFS-relative.

The scanner is a portability checker, not a malware detector.

## Local preview

Preview the exact selected bytes using the exact production iframe policy before publish.

No permissive admin-only preview mode.

## Wallet isolation

Never expose the CCC signer or admin transaction objects to the demo iframe.
