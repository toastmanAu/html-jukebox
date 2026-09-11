export class CKBFSError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(`${code}: ${message}`); this.name = 'CKBFSError';
  }
}
export function invariant(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new CKBFSError(code, message);
}
/** CCC/RPC transports may reject with a plain JSON object instead of Error. */
export function formatDiagnostic(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    try { return `RPC_ERROR: ${JSON.stringify(error, (_key, value) => typeof value === 'bigint' ? value.toString() : value)}. Check the Pudge RPC connection and retry.`; }
    catch { return 'RPC_ERROR: Unreadable RPC failure. Check the Pudge connection and retry.'; }
  }
  return `UNEXPECTED_ERROR: ${String(error)}. Retry the operation.`;
}
