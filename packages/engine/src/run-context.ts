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
  /** true once this invocation's time budget is spent and it has done some work */
  shouldYield(): boolean;
  /** record a finished unit of work (a stage, or a target inside a stage) */
  progress(): void;
}

/** A Qloo call that failed outright (not "empty"): the stage stops instead of guessing. */
export class QlooCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QlooCallError';
  }
}
