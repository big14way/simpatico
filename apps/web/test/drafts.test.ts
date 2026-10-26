import { describe, expect, it } from 'vitest';
import { publicDraft } from '../lib/drafts';

describe('publicDraft', () => {
  it('never shows the sandbox inbox address', () => {
    const d = { id: 'd1', intendedRecipient: 'partnerships@brand.com', deliveredTo: 'builder@example.com' };
    expect(publicDraft(d).deliveredTo).toBe('the sandbox inbox');
    expect(publicDraft({ ...d, deliveredTo: 'partnerships@brand.com' }).deliveredTo).toBe('partnerships@brand.com');
    expect(publicDraft({ ...d, deliveredTo: null }).deliveredTo).toBeNull();
  });
});
