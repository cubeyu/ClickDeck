import { describe, expect, it, vi } from 'vitest';
import { createPrivateCollaborationStorage } from './private-collaboration-storage';
const key = 'clickdeck:collaboration-auth:v1';
function legacy() {
  return { get: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
    set: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
}
describe('private collaboration storage failure boundary', () => {
  it('does not access storage for a non-private key', async () => {
    const old = legacy(); const store = createPrivateCollaborationStorage({ legacy: old });
    await expect(store.get('draft')).rejects.toThrow('invalid-private-storage-key');
    await expect(store.set({ draft: 'keep' })).rejects.toThrow('invalid-private-storage-key');
    await expect(store.remove('draft')).rejects.toThrow('invalid-private-storage-key');
    expect(old.get).not.toHaveBeenCalled();
  });
  it('preserves old data when the private database cannot open', async () => {
    const old = legacy(); old.get.mockResolvedValue({ [key]: { userId: 'synthetic' } });
    const factory = { open: vi.fn(() => { throw new Error('unavailable'); }) } as unknown as IDBFactory;
    const store = createPrivateCollaborationStorage({ legacy: old, factory });
    await expect(store.get(key)).rejects.toThrow('identity-storage-failed');
    expect(old.remove).not.toHaveBeenCalled(); expect(old.set).not.toHaveBeenCalled();
  });
  it('allows a failed legacy read to be retried without silently discarding it', async () => {
    const old = legacy(); old.get.mockRejectedValueOnce(new Error('read failed'));
    const store = createPrivateCollaborationStorage({ legacy: old });
    await expect(store.initialize()).rejects.toThrow('identity-storage-failed');
    await store.initialize(); expect(old.get).toHaveBeenCalledTimes(2);
    expect(old.remove).not.toHaveBeenCalled();
  });
  it('shares initialization without modifying unrelated drafts', async () => {
    const old = legacy(); old.get.mockResolvedValue({ draft: { text: 'keep' } });
    const store = createPrivateCollaborationStorage({ legacy: old });
    await Promise.all([store.initialize(), store.initialize()]);
    expect(old.get).toHaveBeenCalledTimes(1); expect(old.set).not.toHaveBeenCalled();
    expect(old.remove).not.toHaveBeenCalled();
  });
});
