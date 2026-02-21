/**
 * Minifig Sync SSE Stream Types
 *
 * Shared event types for server-sent event streaming
 * across pull-inventory, research, and create-listings operations.
 */

/** Progress callback signature used by services (may be async for SSE writes) */
export type SyncProgressCallback = (event: SyncProgressEvent) => void | Promise<void>;

/** Events emitted during sync operations */
export type SyncProgressEvent =
  | { type: 'stage'; stage: string; message: string }
  | { type: 'progress'; current: number; total: number; message: string }
  | { type: 'complete'; data: Record<string, unknown> }
  | { type: 'error'; error: string };

/** SSE event sent over the wire (wraps SyncProgressEvent) */
export type SyncStreamEvent = SyncProgressEvent;

/** Format an event as an SSE data line */
export function formatSSE(event: SyncStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Sync operation type for the streaming hook */
export type SyncOperation = 'pull-inventory' | 'research' | 'create-listings';

/** Labels for each operation (used in dialog titles) */
export const SYNC_OPERATION_LABELS: Record<SyncOperation, string> = {
  'pull-inventory': 'Pull Inventory',
  research: 'Research',
  'create-listings': 'Create Listings',
};

/** State of the sync stream on the client side */
export interface SyncStreamState {
  status: 'idle' | 'streaming' | 'complete' | 'error';
  operation: SyncOperation | null;
  stage: string | null;
  stageMessage: string | null;
  current: number;
  total: number;
  itemMessage: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}
