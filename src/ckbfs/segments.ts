import type * as ccc from '@ckb-ccc/core';
import { CKBFSError, invariant } from './errors';
import { prepareV3, type PublishOptions } from './publisher';
/** A starting budget, not a safety check: prepareV3 validates the actual final serialization. */
export const SEGMENT_BYTES = 80 * 1024;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export async function prepareV3Segment(opts: Omit<PublishOptions, 'persistSigned'>, start: number, prior?: ccc.Cell) {
  invariant(Number.isSafeInteger(start) && start >= 0 && start < opts.content.length, 'INVALID_SEGMENT', 'Segment offset is outside the selected file.');
  invariant(opts.content.length <= MAX_FILE_BYTES, 'CONTENT_TOO_LARGE', 'The complete file exceeds the 32 MiB resolver limit.');
  let length = Math.min(SEGMENT_BYTES, opts.content.length - start);
  for (;;) {
    try { return { prepared: await prepareV3({ ...opts, content: opts.content.slice(start, start + length) }, prior), start, end: start + length }; }
    catch (error) {
      if (!(error instanceof CKBFSError) || error.code !== 'CONTENT_TOO_LARGE' || length <= 1) throw error;
      length = Math.max(1, Math.floor(length / 2));
    }
  }
}
