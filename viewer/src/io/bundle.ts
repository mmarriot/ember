// The reader of .ember bundles (docs/format.md; the types are in format.ts). Opening a bundle reads its header and
// index; then each event is one ranged read of its record, decompressed off the main thread. Columns are typed-array
// views on the decompressed record: no parsing and no copies.
import {
  COLUMN_TYPES,
  type EventData,
  type Header,
  type IndexEntry,
  type Relation,
  type RunEntry,
  type RunInfo,
  type Table,
  type TypeCode,
} from "./format";

/** Random access to bytes: an HTTP URL or a Blob (local file, tests). */
export interface Source {
  size: number;
  read(offset: number, length: number): Promise<ArrayBuffer>;
}

export function blobSource(blob: Blob): Source {
  return { size: blob.size, read: (offset, length) => blob.slice(offset, offset + length).arrayBuffer() };
}

/** The server's refusal of a file (404: not there, 403: not for this person), kept apart from a file that is there
 *  but unreadable, so the page can say which. */
export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url}: HTTP ${status}`);
  }
}
/** No answer at all: the connection, or a request the browser would not make or let the page read (another site
 *  without permission for this one; an expired sign-on, which redirects to the login page of another site). */
export class NetworkError extends Error {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super(`${url}: ${cause instanceof Error ? cause.message : cause}`);
  }
}
/** The bytes are there but are not a bundle: wrong first bytes, no trailer (cut short), or a header that is not JSON. */
export class FormatError extends Error {}
/** fetch, with its rejection (a TypeError, whatever the cause) as a NetworkError: other TypeErrors are bugs. */
const request = (url: string, init: RequestInit) =>
  fetch(url, init).catch((e) => {
    throw new NetworkError(url, e);
  });

export async function httpSource(url: string): Promise<Source> {
  // A file replaced under the same name (a data set converted again) must not be read from the browser's cache of the
  // old one: the probe bypasses the cache, and every read names the version it found (the server ignores the query),
  // so cached ranges of another version are never used, while those of this one still are.
  const probe = await request(url, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
  if (!probe.ok) throw new HttpError(url, probe.status);
  if (probe.status === 200) return blobSource(await probe.blob()); // server ignores Range: keep the whole file
  const size = Number(probe.headers.get("Content-Range")?.split("/")[1]);
  const validator = probe.headers.has("ETag") ? "ETag" : "Last-Modified",
    version = probe.headers.get(validator);
  const at = version ? `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}` : url;
  // Servers (or caches in between) may answer any range request with the whole file (HTTP 200): from then on
  // keep that copy and serve every read from it.
  let whole: Promise<Blob> | null = null;
  return {
    size,
    async read(offset, length) {
      if (!whole) {
        const r = await request(at, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
        if (r.status === 206) {
          // from the file opened: one replaced since would give its bytes at this one's offsets
          if (version && r.headers.get(validator) !== version)
            throw new Error(`${url} changed on the server since it was opened: open it again`);
          return r.arrayBuffer();
        }
        if (!r.ok) throw new HttpError(url, r.status);
        whole = r.blob();
      }
      return (await whole).slice(offset, offset + length).arrayBuffer();
    },
  };
}

const text = (buf: ArrayBuffer) => new TextDecoder().decode(buf);
const inflate = (buf: ArrayBuffer) =>
  new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
// Inflating a PU200 record (~35 MB to ~100 MB) blocks the thread that does it for a few hundred ms: a worker does it,
// so the view keeps responding, also while the next event is read ahead. Without workers (tests), it is done here.
let worker: Worker | null = null,
  jobs = 0,
  noWorker = false;
const waiting = new Map<number, { done: (buf: ArrayBuffer) => void; fail: (e: Error) => void }>();
function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof Worker === "undefined" || noWorker) return inflate(buf);
  if (!worker) {
    worker = new Worker(new URL("./gunzip.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; buf?: ArrayBuffer; error?: string }>) => {
      const job = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.buf) job?.done(data.buf);
      else job?.fail(new Error(data.error));
    };
    worker.onerror = () => {
      // it could not start (e.g. its file is missing): the reads waiting on it fail, later
      for (const job of waiting.values()) job.fail(new Error("the decompression worker failed")); // ones inflate here
      waiting.clear();
      worker?.terminate();
      worker = null;
      noWorker = true;
    };
  }
  const id = jobs++;
  return new Promise((done, fail) => {
    waiting.set(id, { done, fail });
    worker!.postMessage({ id, buf }, [buf]); // moved, not copied: `buf` is empty here afterwards
  });
}

/** The events to keep decoded once event `i` of `n` is shown, coming from event `from`: it and its neighbours; and the
 *  one to read ahead, the next in the direction of travel (forward after a jump; the events wrap around). */
export function around(i: number, from: number, n: number): { keep: number[]; next: number | null } {
  const step = (from - i + n) % n === 1 ? -1 : 1,
    at = (k: number) => (((i + k) % n) + n) % n;
  return { keep: [...new Set([i, at(step), at(-step)])], next: n > 1 ? at(step) : null };
}

export class Bundle {
  private readonly runTables = new Map<number, Promise<Record<string, Table>>>(); // read once per run
  private readonly decoded = new Map<number, Promise<EventData>>(); // events read, until keep() lets them go
  private constructor(
    readonly header: Header,
    readonly events: IndexEntry[],
    readonly runs: RunEntry[],
    private readonly source: Source,
  ) {}

  static async open(source: Source): Promise<Bundle> {
    try {
      // "EVDB" is the magic of format version 1, from when the project was called evd. Every bundle written so far
      // has it, so it stays (docs/format.md).
      const head = new DataView(await source.read(0, 12));
      if (text(head.buffer.slice(0, 4)) !== "EVDB" || head.getUint32(4, true) !== 1)
        throw new FormatError("not an Ember bundle of format version 1");
      const header: Header = JSON.parse(text(await source.read(12, head.getUint32(8, true))));
      const trailer = new DataView(await source.read(source.size - 16, 16));
      if (text(trailer.buffer.slice(12, 16)) !== "EVDB") throw new FormatError("bundle has no trailer (incomplete?)");
      const index = JSON.parse(
        text(await source.read(Number(trailer.getBigUint64(0, true)), trailer.getUint32(8, true))),
      );
      return new Bundle(header, index.events, index.runs ?? [], source);
    } catch (e) {
      // A file too short for its header or trailer (RangeError from the DataView), or whose header or index is not
      // JSON (SyntaxError): not a bundle either. What the source itself reports (HTTP, network) is passed on.
      if (e instanceof RangeError || e instanceof SyntaxError)
        throw new FormatError(`not a complete Ember bundle (${e.message})`);
      throw e;
    }
  }

  /** Event i, with the per-run tables of its run (if the bundle has any) added to its own. Read once while kept (see
   *  keep); a read that fails is tried again on the next call. */
  event(i: number): Promise<EventData> {
    let ev = this.decoded.get(i);
    if (!ev) {
      const read = (ev = this.read(i));
      this.decoded.set(i, read);
      read.catch(() => {
        if (this.decoded.get(i) === read) this.decoded.delete(i);
      });
    }
    return ev;
  }

  /** Keep only these events read: the others are freed once nothing else holds them (a PU200 event is ~100 MB). */
  keep(indices: number[]) {
    for (const i of [...this.decoded.keys()]) if (!indices.includes(i)) this.decoded.delete(i);
  }

  private async read(i: number): Promise<EventData> {
    const entry = this.events[i];
    const [ev, perRun] = await Promise.all([this.record(entry), this.run(entry.run)]);
    ev.tables = { ...perRun, ...ev.tables };
    return ev;
  }

  private run(run: number): Promise<Record<string, Table>> {
    const entry = this.runs.find((r) => r.run === run);
    if (entry?.offset === undefined || entry.length === undefined) return Promise.resolve({});
    if (!this.runTables.has(run))
      this.runTables.set(
        run,
        this.record({ offset: entry.offset, length: entry.length }).then((r) => r.tables),
      );
    return this.runTables.get(run)!;
  }

  /** What is known about a run (type, setup, beam, ...), or {}. */
  runInfo(run: number): RunInfo {
    return this.runs.find((r) => r.run === run)?.info ?? {};
  }

  /** The profile's run title filled in for `run`: parts naming a field the run lacks are dropped. */
  runTitle(run: number): string {
    const info = this.runInfo(run),
      template = this.header.runTitle;
    if (!template) return "";
    return template
      .split(" · ")
      .filter((part) => [...part.matchAll(/\{(\w+)\}/g)].every(([, k]) => info[k] !== undefined && info[k] !== ""))
      .map((part) => part.replace(/\{(\w+)\}/g, (_, k) => String(info[k])))
      .join(" · ");
  }

  private async record(entry: { offset: number; length: number }) {
    return parseRecord(await gunzip(await this.source.read(entry.offset, entry.length)), this.header);
  }
}

/** Where an array is in a record's binary chunk: [byte offset from the start of the chunk, number of elements]. */
type Span = [number, number];
/** A record's own JSON header (docs/format.md "Record"): where each column and relation array is. */
interface RecordMeta {
  event: [number, number, number];
  tables: Record<string, { n: number; columns: Record<string, Span> }>;
  relations: Record<string, { offsets: Span; indices: Span; weights: Record<string, Span> }>;
}

/** An event (or run) record, decompressed: "EVD1", u32 JSON length, the JSON (RecordMeta), then the binary chunk. Each
 *  column becomes a typed-array view on `buf` of the type its header entry names. */
function parseRecord(buf: ArrayBuffer, header: Header): EventData {
  const dv = new DataView(buf);
  if (text(buf.slice(0, 4)) !== "EVD1") throw new Error("bad event record");
  const hlen = dv.getUint32(4, true);
  const meta: RecordMeta = JSON.parse(text(buf.slice(8, 8 + hlen)));
  const base = 8 + hlen;
  const view = <T extends TypeCode>(type: T, [offset, length]: Span) =>
    new COLUMN_TYPES[type](buf, base + offset, length) as InstanceType<(typeof COLUMN_TYPES)[T]>;

  const tables: Record<string, Table> = {};
  for (const [name, t] of Object.entries(meta.tables)) {
    const types = header.tables[name].columns;
    tables[name] = {
      n: t.n,
      columns: Object.fromEntries(Object.entries(t.columns).map(([c, loc]) => [c, view(types[c].type, loc)])),
    };
  }
  const relations: Record<string, Relation> = {};
  for (const [name, r] of Object.entries(meta.relations)) {
    relations[name] = {
      offsets: view("u32", r.offsets),
      indices: view("u32", r.indices),
      weights: Object.fromEntries(Object.entries(r.weights).map(([w, loc]) => [w, view("f32", loc)])),
    };
  }
  return { id: meta.event, tables, relations };
}
