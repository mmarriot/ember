// Decompresses event records off the main thread (io/bundle.ts gunzip): a PU200 record inflates to ~100 MB, which takes
// a few hundred ms. Buffers move in and out by transfer, not by copy.
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (e: MessageEvent<{ id: number; buf: ArrayBuffer }>) => {
  const { id, buf } = e.data;
  try {
    const out = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    scope.postMessage({ id, buf: out }, [out]);
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
