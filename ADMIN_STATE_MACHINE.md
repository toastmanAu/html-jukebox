# Admin Publish State Machine

## Stages

```text
IDLE
FILE_SELECTED
INSPECTED
PREVIEW_OK
DEMO_PUBLISHING
DEMO_PUBLISHED
DEMO_VERIFYING
DEMO_VERIFIED
MANIFEST_BUILDING
MANIFEST_PUBLISHING
MANIFEST_PUBLISHED
MANIFEST_VERIFYING
MANIFEST_VERIFIED
REGISTRY_UPDATING
REGISTRY_VERIFYING
COMPLETE
ERROR_RECOVERABLE
ERROR_FATAL
```

## Persisted draft

```ts
type PublishDraft = {
  draftId: string;
  stage: PublishStage;

  local: {
    filename: string;
    bytes: number;
    contentHash: string;
    metadata: DemoMetadataDraft;
  };

  demo?: {
    typeId: string;
    txHash: string;
    verified: boolean;
  };

  manifest?: {
    revision: number;
    contentHash: string;
    typeId?: string;
    txHash?: string;
    verified: boolean;
  };

  registry?: {
    previousOutPoint: string;
    updateTxHash?: string;
  };

  updatedAt: string;
};
```

Never store private keys.

## Recovery

### Demo publish succeeded; later stage failed
Never upload demo again automatically.

### Manifest publish succeeded; registry update failed
Reuse known manifest Type ID/hash and retry only registry step.

### Registry broadcast uncertain
Before retry:
- re-query registry by Type ID;
- inspect current revision and manifest pointer;
- detect whether the previous transaction already committed.

## Owner authorization

Mutation controls enable only when:
- JoyID connected;
- client is Pudge/testnet;
- registry found;
- recommended connected lock script equals registry lock.

Diagnostics may remain viewable without owner authorization.

## Every wallet prompt should show

Before signing:
- operation
- TESTNET/PUDGE
- filename or manifest revision
- bytes/chunks
- estimated capacity/fee
- what changes on-chain

After broadcast:
- transaction hash
- explorer link
- confirmation state
- next safe step

## Optional screenshot publication

Persist locally optimized image bytes, hash, MIME, dimensions, and original byte count with the initial draft. The approved screenshot is immutable within that saved draft. After DEMO_VERIFIED, an attached image advances through SCREENSHOT_PUBLISHING → SCREENSHOT_PUBLISHED → SCREENSHOT_VERIFYING → SCREENSHOT_VERIFIED before manifest creation. Use the locked V3 publisher and unchanged final serialized-size guard. Persist the signed screenshot transaction before broadcasting; independent resolution must verify its exact bytes, MIME, checksum, and hash. Recovery prefers the latest screenshot receipt over the earlier demo receipt and never repeats either upload after a later failure.

For an existing demo, `screenshotFor` holds the selected verified manifest item. The user reviews the optimized raster before saving the screenshot update; no new HTML is selected or executed. Recheck the unchanged registry and selected item, publish/verify only the screenshot, and continue through manifest/registry publication. Existing drafts lacking screenshot fields remain resumable. After registry broadcast, verify that signed registry receipt directly, rather than comparing it against the superseded registry.
