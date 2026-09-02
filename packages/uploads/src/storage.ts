import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** A stored object — a key into the object store plus verifiable metadata. */
export interface StoredObjectRef {
  readonly storageKey: string;
  readonly byteSize: number;
  readonly contentHash: string;
}

export interface PutInput {
  readonly childId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/**
 * Object-store port for uploaded evidence artefacts. Bytes live here, never in
 * Postgres. Every backing implementation is swappable behind this interface.
 */
export interface UploadStorageAdapter {
  readonly name: string;
  put(input: PutInput): Promise<StoredObjectRef>;
  getBytes(storageKey: string): Promise<Uint8Array>;
  remove(storageKey: string): Promise<void>;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
}

function objectKey(childId: string, filename: string): string {
  return `child/${childId}/${randomUUID()}-${safeName(filename)}`;
}

/** In-process store — for tests and ephemeral dev. */
export class InMemoryUploadStorageAdapter implements UploadStorageAdapter {
  readonly name = 'in-memory';
  readonly #objects = new Map<string, Uint8Array>();

  put(input: PutInput): Promise<StoredObjectRef> {
    const storageKey = objectKey(input.childId, input.filename);
    this.#objects.set(storageKey, input.bytes);
    return Promise.resolve({
      storageKey,
      byteSize: input.bytes.byteLength,
      contentHash: sha256Hex(input.bytes),
    });
  }
  getBytes(storageKey: string): Promise<Uint8Array> {
    const b = this.#objects.get(storageKey);
    if (!b) return Promise.reject(new Error(`no object at ${storageKey}`));
    return Promise.resolve(b);
  }
  remove(storageKey: string): Promise<void> {
    this.#objects.delete(storageKey);
    return Promise.resolve();
  }
}

/** Local filesystem store — the default dev adapter. */
export class LocalFsUploadStorageAdapter implements UploadStorageAdapter {
  readonly name = 'local-fs';
  readonly #baseDir: string;

  constructor(baseDir: string) {
    this.#baseDir = resolve(baseDir);
  }

  async put(input: PutInput): Promise<StoredObjectRef> {
    const storageKey = objectKey(input.childId, input.filename);
    const path = join(this.#baseDir, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.bytes);
    return {
      storageKey,
      byteSize: input.bytes.byteLength,
      contentHash: sha256Hex(input.bytes),
    };
  }
  async getBytes(storageKey: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(join(this.#baseDir, storageKey)));
  }
  async remove(storageKey: string): Promise<void> {
    await rm(join(this.#baseDir, storageKey), { force: true });
  }
}

export class StorageCredentialsRequiredError extends Error {
  readonly code = 'STORAGE_ENV_REQUIRED';
  constructor(missing: string) {
    super(`Supabase storage needs ${missing} (ENV_REQUIRED)`);
    this.name = 'StorageCredentialsRequiredError';
  }
}

export interface SupabaseStorageConfig {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly bucket: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Supabase Storage adapter (production). Structured but INERT without real
 * credentials — construction throws {@link StorageCredentialsRequiredError} so a
 * misconfigured production never silently loses uploads.
 */
export class SupabaseStorageAdapter implements UploadStorageAdapter {
  readonly name = 'supabase';
  readonly #cfg: Required<Omit<SupabaseStorageConfig, 'fetchImpl'>>;
  readonly #fetch: typeof fetch;

  constructor(cfg: SupabaseStorageConfig) {
    if (!cfg.url) throw new StorageCredentialsRequiredError('SUPABASE_URL');
    if (!cfg.serviceRoleKey) throw new StorageCredentialsRequiredError('SUPABASE_SERVICE_ROLE_KEY');
    if (!cfg.bucket) throw new StorageCredentialsRequiredError('SUPABASE_STORAGE_BUCKET');
    this.#cfg = { url: cfg.url.replace(/\/$/, ''), serviceRoleKey: cfg.serviceRoleKey, bucket: cfg.bucket };
    this.#fetch = cfg.fetchImpl ?? globalThis.fetch;
  }

  async put(input: PutInput): Promise<StoredObjectRef> {
    const storageKey = objectKey(input.childId, input.filename);
    const res = await this.#fetch(
      `${this.#cfg.url}/storage/v1/object/${this.#cfg.bucket}/${storageKey}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#cfg.serviceRoleKey}`,
          'content-type': input.mimeType || 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: input.bytes,
      },
    );
    if (!res.ok) throw new Error(`supabase storage put failed: ${res.status}`);
    return { storageKey, byteSize: input.bytes.byteLength, contentHash: sha256Hex(input.bytes) };
  }
  async getBytes(storageKey: string): Promise<Uint8Array> {
    const res = await this.#fetch(
      `${this.#cfg.url}/storage/v1/object/${this.#cfg.bucket}/${storageKey}`,
      { headers: { authorization: `Bearer ${this.#cfg.serviceRoleKey}` } },
    );
    if (!res.ok) throw new Error(`supabase storage get failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async remove(storageKey: string): Promise<void> {
    await this.#fetch(`${this.#cfg.url}/storage/v1/object/${this.#cfg.bucket}/${storageKey}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${this.#cfg.serviceRoleKey}` },
    });
  }
}

export interface StorageEnv {
  readonly DZ_UPLOAD_DIR?: string | undefined;
  readonly SUPABASE_URL?: string | undefined;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
  readonly SUPABASE_STORAGE_BUCKET?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

/**
 * Pick the storage adapter from the environment:
 *  - Supabase when URL + service-role key + bucket are all set;
 *  - otherwise local filesystem at `DZ_UPLOAD_DIR` (default `./.dz-uploads`).
 * The in-memory adapter is never auto-selected — pass it explicitly in tests.
 */
export function resolveUploadStorageAdapter(env: StorageEnv): {
  adapter: UploadStorageAdapter;
  kind: 'supabase' | 'local-fs';
} {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_STORAGE_BUCKET) {
    return {
      adapter: new SupabaseStorageAdapter({
        url: env.SUPABASE_URL,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
        bucket: env.SUPABASE_STORAGE_BUCKET,
      }),
      kind: 'supabase',
    };
  }
  return {
    adapter: new LocalFsUploadStorageAdapter(env.DZ_UPLOAD_DIR ?? './.dz-uploads'),
    kind: 'local-fs',
  };
}
