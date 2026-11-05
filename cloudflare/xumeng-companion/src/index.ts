import { DurableObject } from 'cloudflare:workers';
import { companionProfile } from './cast';
import { CompanionDesk } from './desk';
import { CompanionHost, CONTAINER_INACTIVITY_MS, PoolFullError, authorizeService, sharedEnvironment,
  type Bucket, type HostEnv, type Runtime, type RuntimePool } from './host';

export { CompanionDesk };

interface Env extends HostEnv {
  COMPANIONS: DurableObjectNamespace<CompanionAccount>;
  DESK: DurableObjectNamespace<CompanionDesk>;
  POOLS?: DurableObjectNamespace<CompanionPool>;
  MEMORY: R2Bucket;
  COMPANION_POOL_SHARDS?: string;
  COMPANION_POOL_CAPACITY?: string;
}
function hex(value: ArrayBuffer | undefined): string | undefined {
  return value && [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const TENANT_ROUTE = /^\/tenants\/([a-f0-9]{64})(\/.*)$/;
const FORWARDED_HEADERS = ['content-type', 'content-length', 'x-snapshot-sha256'];

function poolRuntime(namespace: DurableObjectNamespace<CompanionPool>, shard: number, tenant: string): Runtime {
  const stub = namespace.get(namespace.idFromName(`pool-${shard}`));
  const call = (path: string, init: RequestInit = {}) => stub.fetch(`https://pool.internal/tenants/${tenant}${path}`, init);
  const json = { 'content-type': 'application/json' };
  return {
    async isRunning() {
      const response = await call('/exists');
      await response.body?.cancel();
      if (response.status === 404) return false;
      if (!response.ok) throw new Error('Pool tenant state unavailable');
      return true;
    },
    async start(env) {
      const response = await call('/create', { method: 'POST', headers: json,
        body: JSON.stringify({ accountId: env.COMPANION_ACCOUNT_ID, chatModel: env.COMPANION_CHAT_MODEL, persona: env.COMPANION_PERSONA }) });
      const value = await response.json().catch(() => null) as { code?: string } | null;
      if (response.status === 503 && value?.code === 'POOL_FULL') throw new PoolFullError();
      if (!response.ok) throw new Error('Pool tenant start failed');
    },
    async setInactivityTimeout() { /* The pool object owns its container lifetime. */ },
    fetch: (path, init) => call(path, init),
    async destroy() {
      const response = await call('/destroy', { method: 'POST', headers: json, body: '{}' });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw new Error('Pool tenant destroy failed');
    },
  };
}

export class CompanionAccount extends DurableObject<Env> {
  private host: CompanionHost;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (!container) throw new Error('Companion container is not configured');
    if (container.running) ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(CONTAINER_INACTIVITY_MS));
    const runtime: Runtime = {
      async isRunning() { return container.running; },
      async start(runtimeEnv) {
        // The default scheduler supplies the image/size and enforces max_instances.
        container.start({ enableInternet: true, env: runtimeEnv });
      },
      setInactivityTimeout: ms => container.setInactivityTimeout(ms),
      fetch: (path, init) => container.getTcpPort(8080).fetch(`http://container${path}`, init),
      destroy: () => container.destroy('Committed native checkpoint'),
    };
    const shards = Number(env.COMPANION_POOL_SHARDS || 0);
    const pools = env.POOLS;
    const pool: RuntimePool | undefined = pools && Number.isInteger(shards) && shards > 0
      ? { shards, runtime: (shard, tenant) => poolRuntime(pools, shard, tenant) } : undefined;
    const memory: Bucket = {
      async get(key) {
        const object = await env.MEMORY.get(key);
        return object && { body: object.body, size: object.size, etag: object.etag,
          sha256: hex(object.checksums.sha256), metadata: object.customMetadata || {} };
      },
      async put(key, input, options) {
        let body: ReadableStream<Uint8Array> | string = input;
        let piping: Promise<void> | undefined;
        const abort = new AbortController();
        if (typeof input !== 'string' && options.length !== undefined) {
          const fixed = new FixedLengthStream(options.length);
          piping = input.pipeTo(fixed.writable, { signal: abort.signal });
          // Attach immediately: a failed source stream must not create an unhandled rejection.
          void piping.catch(() => {});
          body = fixed.readable;
        }
        try {
          const checksum = options.sha256 ? new Uint8Array(options.sha256.match(/../g)!.map(part => parseInt(part, 16))).buffer : undefined;
          const result = await env.MEMORY.put(key, body, { customMetadata: options.metadata,
            onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: options.contentType },
            ...(checksum ? { sha256: checksum } : {}) });
          if (!result) throw new Error('Immutable checkpoint key already exists');
          await piping;
          return { etag: result.etag };
        } catch (error) {
          abort.abort(); await piping?.catch(() => {}); throw error;
        }
      },
    };
    const storage = {
      get: <T>(key: string) => ctx.storage.get<T>(key),
      put: <T>(key: string, value: T) => ctx.storage.put(key, value),
      delete: async (key: string) => { await ctx.storage.delete(key); },
      list: <T>(options?: { prefix?: string; limit?: number }) => ctx.storage.list<T>(options),
      setAlarm: (time: number) => ctx.storage.setAlarm(time),
      getAlarm: () => ctx.storage.getAlarm(),
    };
    this.host = new CompanionHost(storage, memory, runtime, env, undefined, undefined, pool);
  }
  fetch(request: Request) { return this.host.fetch(request); }
  alarm() { return this.host.alarm(); }
}

/**
 * One warm container per shard; each account inside it still has its own
 * native process and instance directory (see container/control.mjs). Only
 * CompanionAccount objects call this class, with host-derived tenant keys.
 */
export class CompanionPool extends DurableObject<Env> {
  private starting: Promise<void> | null = null;
  private controllerReady = false;
  private keptAliveAt = 0;

  /** The platform call is slow; once a minute is plenty for the six-hour timeout. */
  private async keepAlive(): Promise<void> {
    if (Date.now() - this.keptAliveAt < 60_000) return;
    await this.ctx.container!.setInactivityTimeout(CONTAINER_INACTIVITY_MS);
    this.keptAliveAt = Date.now();
  }

  private async token(): Promise<string> {
    let token = await this.ctx.storage.get<string>('control-token');
    if (!token) { token = crypto.randomUUID() + crypto.randomUUID(); await this.ctx.storage.put('control-token', token); }
    return token;
  }
  private async controller(path: string, init: RequestInit = {}, timeout = 30_000): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${await this.token()}`);
    return this.ctx.container!.getTcpPort(8080).fetch(`http://container${path}`, { ...init, headers, signal: AbortSignal.timeout(timeout) });
  }
  private async ensureContainer(): Promise<void> {
    const container = this.ctx.container!;
    if (container.running && this.controllerReady) return;
    this.starting ??= (async () => {
      this.controllerReady = false; this.keptAliveAt = 0;
      if (!container.running) {
        container.start({ enableInternet: true, env: { ...sharedEnvironment(this.env), COMPANION_POOL_MODE: '1',
          COMPANION_POOL_CAPACITY: this.env.COMPANION_POOL_CAPACITY || '8', COMPANION_CONTROL_TOKEN: await this.token(), PORT: '8080' } });
      }
      for (let attempt = 0; attempt < 90; attempt++) {
        try {
          const response = await this.controller('/health', {}, 1_500);
          const value = await response.json().catch(() => null) as { pool?: boolean } | null;
          if (response.ok && value?.pool === true) { this.controllerReady = true; return; }
        } catch { /* The controller port is not open yet. */ }
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
      throw new Error('Pool controller did not become ready');
    })().finally(() => { this.starting = null; });
    await this.starting;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const container = this.ctx.container;
    if (!container) return Response.json({ error: 'Pool container is not configured', code: 'POOL_UNAVAILABLE' }, { status: 503 });
    if (url.pathname === '/warm' && request.method === 'POST') {
      await this.ensureContainer();
      await this.keepAlive();
      return Response.json({ warm: true });
    }
    const match = TENANT_ROUTE.exec(url.pathname);
    if (!match) return Response.json({ error: 'Not found' }, { status: 404 });
    // Checking for a tenant must never boot a container: no container means no tenant.
    if (match[2] === '/exists' && !container.running) { this.controllerReady = false; return Response.json({ exists: false, code: 'TENANT_NOT_FOUND' }, { status: 404 }); }
    try { await this.ensureContainer(); }
    catch { return Response.json({ error: 'Pool container is starting', code: 'CONTAINER_STARTING' }, { status: 503 }); }
    await this.keepAlive();
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) { const value = request.headers.get(name); if (value) headers.set(name, value); }
    return this.controller(url.pathname, { method: request.method, headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body }, 180_000);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // workers.dev and preview URLs are disabled. The sole caller is the authenticated Web service binding.
    const account = authorizeService(request, env);
    if (account instanceof Response) return account;
    const url = new URL(request.url);
    const profile = companionProfile(request.headers.get('x-xumeng-companion-profile'));
    if (!profile) return Response.json({ error: '无法访问这段聊天。', code: 'ACCOUNT_MISMATCH' }, { status: 403, headers: { 'cache-control': 'no-store' } });
    // Desk routes never start a chat container. They only remember who was talking.
    if (url.pathname.startsWith('/api/desk/')) {
      const headers = new Headers({ 'x-xumeng-account-id': account, 'x-xumeng-companion-profile': profile });
      if (request.headers.has('content-type')) headers.set('content-type', request.headers.get('content-type')!);
      return env.DESK.get(env.DESK.idFromName('companion-desk')).fetch(new Request(request.url, {
        method: request.method, headers, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      }));
    }
    const id = env.COMPANIONS.idFromName(profile === 'classic' ? account : `${account}:${profile}`);
    const headers = new Headers({ 'x-xumeng-account-id': account, 'x-xumeng-companion-profile': profile });
    if (request.headers.has('content-type')) headers.set('content-type', request.headers.get('content-type')!);
    // The browser session token is forwarded only to the host coordinator for
    // one billing reservation. The native container never receives it.
    if (request.method === 'POST' && url.pathname.endsWith('/messages')) {
      const token = request.headers.get('x-xumeng-session-token');
      if (token) headers.set('x-xumeng-session-token', token);
    }
    return env.COMPANIONS.get(id).fetch(new Request(request.url, { method: request.method, headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body }));
  },
} satisfies ExportedHandler<Env>;
