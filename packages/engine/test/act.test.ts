import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStore, openDb, type Db, type Store } from '@simpatico/store';
import { withdrawStaleDrafts } from '../src/act';

let db: Db;
let store: Store;
beforeAll(async () => {
  db = await openDb({ dataDir: null });
  store = createStore(db);
});
afterAll(async () => {
  await db.close();
});

async function deal(targetId: string, verdict: string, buyerKey = 'B1') {
  return store.pipeline.upsert({
    buyerKey, buyerName: 'Buyer', dealType: 'licensing', targetId, targetName: targetId, imageUrl: null,
    score: 60, verdict, stage: 'Screened', nextStep: null, lastRunId: 'run_1',
  });
}
async function draft(id: string, pipelineId: string) {
  await store.outreach.create({
    id, runId: 'run_1', pipelineId, targetId: id, targetName: id, intendedRecipient: 'x@example.com',
    subject: 's', body: 'b', bodySha256: 'h', model: null,
  });
}

describe('withdrawStaleDrafts', () => {
  it('withdraws waiting drafts whose deal is no longer ADVANCE, within the screen\'s buyer and deal type', async () => {
    const live = await deal('T-live', 'ADVANCE');
    const down = await deal('T-down', 'WATCH');
    const other = await deal('T-other', 'PASS', 'B2');
    await draft('d_live', live.id);
    await draft('d_down', down.id);
    await draft('d_other', other.id);

    expect(await withdrawStaleDrafts(store, { buyerKey: 'B1', dealType: 'licensing', runId: 'run_2' })).toBe(1);
    expect((await store.outreach.get('d_live'))!.status).toBe('pending');
    expect(await store.outreach.get('d_down')).toMatchObject({ status: 'rejected', error: expect.stringMatching(/no longer ADVANCE \(now WATCH after run_2\)/) });
    expect((await store.outreach.get('d_other'))!.status).toBe('pending');

    // unscoped (the one-off clean-up) reaches every buyer
    expect(await withdrawStaleDrafts(store)).toBe(1);
    expect((await store.outreach.get('d_other'))!.status).toBe('rejected');
    expect((await store.outreach.get('d_live'))!.status).toBe('pending');
  });
});
