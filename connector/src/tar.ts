/** Minimal reader for the gzipped tarballs GitHub serves (ustar + pax path records). */
export async function readTarball(gz: ReadableStream<Uint8Array>): Promise<Map<string, string>> {
  const buf = new Uint8Array(await new Response(gz.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const text = new TextDecoder();
  const field = (o: number, n: number) => text.decode(buf.subarray(o, o + n)).replace(/\0.*$/s, '');
  const files = new Map<string, string>();
  let paxPath: string | null = null;
  for (let off = 0; off + 512 <= buf.length; ) {
    const name = field(off, 100);
    if (!name) break; // two empty blocks end the archive
    const size = parseInt(field(off + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(buf[off + 156] || 48);
    const prefix = field(off + 345, 155);
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const m = text.decode(body).match(/\d+ path=([^\n]*)\n/);
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === 'g') continue;
    const full = paxPath ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    if (type !== '0' && type !== '\0') continue;
    // GitHub wraps everything in "<owner>-<repo>-<sha>/"; drop that.
    files.set(full.split('/').slice(1).join('/'), text.decode(body));
  }
  return files;
}
