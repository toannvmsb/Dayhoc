import { describe, expect, it } from 'vitest';
import { SupabaseStorageAdapter, resolveUploadStorageAdapter } from './storage.js';

/**
 * doc 67 §D3 — real Supabase private Storage against the staging bucket.
 * Gated on `RUN_LIVE_SUPABASE=1` + the three SUPABASE_* storage env vars.
 * put → server-mediated getBytes round-trips; the object is NOT publicly
 * readable; remove works.
 */
const LIVE =
  process.env.RUN_LIVE_SUPABASE === '1' &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.SUPABASE_STORAGE_BUCKET;

describe.skipIf(!LIVE)('doc 67 §D3 — Supabase private Storage (staging, live)', () => {
  it('resolves to the Supabase adapter and round-trips a private object', async () => {
    const resolved = resolveUploadStorageAdapter(process.env);
    expect(resolved.kind).toBe('supabase');

    const adapter = new SupabaseStorageAdapter({
      url: process.env.SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      bucket: process.env.SUPABASE_STORAGE_BUCKET!,
    });

    const bytes = new TextEncoder().encode(`d3-storage-probe ${Date.now()}`);
    const ref = await adapter.put({
      childId: 'stg-child-ref',
      filename: 'probe.txt',
      mimeType: 'text/plain',
      bytes,
    });
    expect(ref.byteSize).toBe(bytes.byteLength);

    try {
      // server-mediated retrieval returns the exact bytes
      const got = await adapter.getBytes(ref.storageKey);
      expect(Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);

      // the object is NOT publicly readable (private bucket) — an unauthenticated
      // GET of the public object URL must fail
      const pub = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_STORAGE_BUCKET}/${ref.storageKey}`,
      );
      expect(pub.ok).toBe(false);
      expect([400, 401, 403, 404]).toContain(pub.status);
    } finally {
      await adapter.remove(ref.storageKey);
    }

    // after remove, retrieval fails
    await expect(adapter.getBytes(ref.storageKey)).rejects.toBeTruthy();
  }, 30_000);
});
