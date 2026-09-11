# UI / UX Specification

## Core visual direction

A believable physical jukebox with a contemporary premium treatment.

Conceptual blend:
- 1940s/1950s jukebox silhouette
- RetroArch/console library navigation
- modern interactive product visualization
- subtle Nervos/CKB identity

Avoid:
- normal SaaS dashboard
- giant rectangular card grid
- generic cyberpunk terminal
- excessive logos
- illegible text rendered into WebGL

## Public scene

Default camera:
slightly elevated frontal three-quarter view, cabinet filling most of the viewport but not cropped on mobile.

Cabinet:
- curved crown/glass
- chrome trim
- wood or dark lacquer
- warm internal lighting
- mechanical title selector
- glowing status glass
- subtle green accents
- soft floor/contact shadow

Background:
dark, restrained environment with enough contrast to make cabinet silhouette clear.

## Selector model

Think jukebox title-card carousel rather than file explorer.

Interaction:
- horizontal category navigation
- vertical/rotary item movement
- swipe on mobile
- mouse wheel
- keyboard arrows
- click/tap
- optional gamepad later

Selected item becomes visually centered and mechanically “locks” into the selector.

Show:
- title
- short description
- category
- tags
- size
- cached state
- verified/on-chain state
- PLAY

## Launch transition

When PLAY:
1. selector locks;
2. cabinet light pulse;
3. mechanical movement / subtle physical response;
4. central display expands;
5. transition to full player;
6. keep host toolbar visible.

Do not block launch behind a long cinematic sequence.

## Admin entry

Do not make admin the public visual focus.

A discreet service latch/gear/control can reveal:
`SERVICE PANEL`.

Admin UI can visually resemble the open service door of a jukebox:
- testnet lamp
- JoyID connection
- diagnostics
- file upload
- publish state machine
- transaction receipts

## Responsive strategy

Mobile is a first-class target.

Requirements:
- one-thumb navigation
- 44px+ touch targets
- no tiny three.js interaction hotspots
- cabinet remains compositionally coherent in portrait
- DOM UI can float over/below cabinet where necessary
- clamp DPR for performance
- adaptive effect quality
- pause/minimize expensive effects while demo iframe is playing

## Accessibility

- all core actions available outside 3D hit testing
- keyboard navigable
- visible focus states
- reduced-motion support
- semantic buttons/forms
- readable contrast
- status text not communicated only by color
