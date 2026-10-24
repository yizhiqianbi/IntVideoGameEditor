import { DurableObject } from 'cloudflare:workers';
import { CompanionHost, CONTAINER_INACTIVITY_MS, authorizeService, type Bucket, type HostEnv, type Runtime } from './host';

interface Env extends HostEnv {
  COMPANIONS: DurableObjectNamespace<CompanionAccount>;
  MEMORY: R2Bucket;
}
function hex(value: ArrayBuffer | undefined): string | undefined {
  return value && [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export class CompanionAccount extends DurableObject<Env> {
  private host: CompanionHost;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (!container) throw new Error('Companion container is not configured');
    if (container.running) ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(CONTAINER_INACTIVITY_MS));
    const runtime: Runtime = {
      get running() { return container.running; },
      start(runtimeEnv) {
        // The default scheduler supplies the image/size and enforces max_instances=5.
        container.start({ enableInternet: true, env: runtimeEnv });
      },
      setInactivityTimeout: ms => container.setInactivityTimeout(ms),
      fetch: (path, init) => container.getTcpPort(8080).fetch(`http://container${path}`, init),
      destroy: () => container.destroy('Committed native checkpoint'),
    };
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
    };
    this.host = new CompanionHost(storage, memory, runtime, env);
  }
  fetch(request: Request) { return this.host.fetch(request); }
  alarm() { return this.host.alarm(); }

  /** Private maintenance RPC; no public HTTP route exposes it. */
  async checkpointForDeployment() {
    await this.host.checkpointNow();
    const state = await this.ctx.storage.get<{phase:string;dirty:boolean;blocked?:string;checkpointError?:boolean;snapshot?:{savedAt:number}}>('runtime');
    if (state && (state.dirty || state.blocked || state.checkpointError || this.ctx.container?.running)) throw new Error('Checkpoint requires review; container preserved');
    return {checkpointed:true,snapshotSavedAt:state?.snapshot?.savedAt ?? null};
  }

}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // workers.dev and preview URLs are disabled. The sole caller is the authenticated Web service binding.
    const account = authorizeService(request, env);
    if (account instanceof Response) return account;
    const requested = request.headers.get('x-qingyu-companion-profile');
    const profile = requested === 'traveler' ? 'traveler' : requested === 'intimate' ? 'intimate' : requested === 'classic' || !requested ? 'classic' : null;
    if (!profile) return Response.json({ error: '陪伴对象无效。', code: 'INVALID_PROFILE' }, { status: 403 });
    const id = env.COMPANIONS.idFromName(profile === 'classic' ? account : `${account}:${profile}`);
    const headers = new Headers({ 'x-xumeng-account-id': account, 'x-qingyu-companion-profile': profile });
    if (request.headers.has('content-type')) headers.set('content-type', request.headers.get('content-type')!);
    // The browser session token is forwarded only to the host coordinator for
    // one billing reservation. The native container never receives it.
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/messages')) {
      const token = request.headers.get('x-xumeng-session-token');
      if (token) headers.set('x-xumeng-session-token', token);
    }
    return env.COMPANIONS.get(id).fetch(new Request(request.url, { method: request.method, headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body }));
  },
} satisfies ExportedHandler<Env>;
