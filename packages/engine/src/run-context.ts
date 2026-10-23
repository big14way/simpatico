import type { QlooClient } from '@simpatico/qloo';
import type { EngineDeps } from './context';
import type { Mandate } from './mandate';
import type { RunState } from './state';

export interface RunCtx {
  deps: EngineDeps;
  runId: string;
  mandate: Mandate;
  state: RunState;
  qloo: QlooClient;
  emit(kind: 'stage' | 'info' | 'warn' | 'progress' | 'claim' | 'needs_input' | 'done' | 'error', message: string, data?: unknown): Promise<void>;
  save(): Promise<void>;
}

/** A Qloo call that failed outright (not "empty"): the stage stops instead of guessing. */
export class QlooCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QlooCallError';
  }
}
