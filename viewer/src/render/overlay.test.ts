import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { layout, type Overlay, svgParts, withText } from "./overlay";

const measure = (text: string, f: { size: number }) => text.length * f.size * 0.5; // a monospace stand-in
const overlay = (o: Partial<Overlay> = {}): Overlay => ({
  label: { bold: "CMS", italic: "Phase-2 Simulation Private Work", caption: ["SIMULATION · ttbar · Run 1"] },
  key: [
    {
      title: "generator particle (truth)",
      entries: [
        { label: "π⁺ · E 7.72 GeV", colours: ["#F0E442"] },
        { label: "pile-up", colours: ["#625a50"], small: true },
      ],
    },
    { title: "HGCal hits", entries: [{ label: "energy 0.01 – 20 GeV", colours: ["#000", "#fff"], ramp: true }] },
  ],
  text: 13,
  panel: true,
  at: {},
  ink: "#e6edf3",
  background: "#0f1419",
  ...o,
});
const W = 1200,
  H = 800;

describe("layout", () => {
  it("puts the label top left and the key top right, inside the picture", () => {
    const [label, key] = layout(overlay(), W, H, 1, measure);
    expect([label.name, key.name]).toEqual(["label", "key"]);
    expect(label.box[0]).toBeLessThan(20);
    expect(label.box[1]).toBeLessThan(20);
    expect(W - (key.box[0] + key.box[2])).toBeLessThan(20);
    for (const { box, shapes } of [label, key])
      for (const s of shapes) {
        const [x, y] = "box" in s ? s.box : [s.x, s.y];
        expect(x).toBeGreaterThanOrEqual(box[0]);
        expect(x).toBeLessThanOrEqual(box[0] + box[2]);
        expect(y).toBeGreaterThanOrEqual(box[1]);
        expect(y).toBeLessThanOrEqual(box[1] + box[3]);
      }
  });

  it("draws the label as the CMS style: the experiment bold, its qualifier italic after it", () => {
    const [label] = layout(overlay(), W, H, 1, measure),
      [cms, qualifier] = label.shapes as { text: string; x: number; font: { bold?: boolean; italic?: boolean } }[];
    expect([cms.text, cms.font.bold, qualifier.text, qualifier.font.italic]).toEqual([
      "CMS",
      true,
      "Phase-2 Simulation Private Work",
      true,
    ]);
    expect(qualifier.x).toBeGreaterThan(cms.x);
  });

  it("lines every key label up, and draws a ramp and the small dots as such", () => {
    const [, key] = layout(overlay(), W, H, 1, measure),
      texts = key.shapes.filter((s) => "text" in s && !s.font.bold) as { x: number }[];
    expect(new Set(texts.map((t) => t.x)).size).toBe(1);
    expect(key.shapes.filter((s) => "ramp" in s)).toHaveLength(1);
    const [big, small] = key.shapes.filter((s) => "dot" in s) as { r: number }[];
    expect(small.r).toBeLessThan(big.r);
  });

  it("is the same picture at every scale, only larger", () => {
    const one = layout(overlay(), W, H, 1, measure),
      four = layout(overlay(), 4 * W, 4 * H, 4, measure);
    one.forEach((b, i) => four[i].box.forEach((v, j) => expect(v).toBeCloseTo(4 * b.box[j], 6)));
  });

  it("puts a block where it was dragged, and keeps it inside the picture", () => {
    const [label, key] = layout(overlay({ at: { label: [0.5, 0.5], key: [0.99, 0.99] } }), W, H, 1, measure);
    expect(label.box.slice(0, 2)).toEqual([600, 400]);
    expect(key.box[0] + key.box[2]).toBeCloseTo(W);
    expect(key.box[1] + key.box[3]).toBeCloseTo(H);
  });

  it("leaves out what is turned off or empty", () => {
    expect(layout(overlay({ key: undefined }), W, H, 1, measure).map((b) => b.name)).toEqual(["label"]);
    const caption = overlay({ label: { bold: "", italic: "", caption: ["", "one line"] } });
    expect(layout(caption, W, H, 1, measure)[0].shapes).toHaveLength(1);
    expect(layout(overlay({ label: undefined, key: [{ title: "x", entries: [] }] }), W, H, 1, measure)).toEqual([]);
  });
});

describe("svgParts", () => {
  it("writes the view's image and one group per block, with text as text, escaped", () => {
    const o = overlay({ label: { bold: "CMS", italic: "a < b & c", caption: [] } }),
      [head, tail] = svgParts(layout(o, W, H, 2, measure), o, [W, H, 2], { title: "T & t", desc: "d" });
    const svg = `${head}data:image/png;base64,AAAA${tail}`;
    expect(svg).toContain('width="600" height="400" viewBox="0 0 1200 800"'); // the size on screen, the pixels inside
    expect(svg).toContain("<title>T &amp; t</title>");
    expect(svg).toContain(">a &lt; b &amp; c</text>");
    expect(svg).toContain('xlink:href="data:image/png;base64,AAAA"/>');
    expect(svg.match(/<g id="(label|key)">/g)).toEqual(['<g id="label">', '<g id="key">']);
    expect(svg).toContain('<linearGradient id="ramp0">');
    expect(svg).toContain('fill="url(#ramp0)"');
  });
});

describe("withText", () => {
  it("adds iTXt chunks after the header chunk, with their checksums, and keeps the image", async () => {
    const png = new Uint8Array(33 + 12).map((_, i) => i), // a signature and header, then the rest
      out = new Uint8Array(
        await withText(new Blob([png]), { Title: "π⁰ · Run 1", Source: "", Software: "Ember" }).arrayBuffer(),
      );
    expect([...out.subarray(0, 33)]).toEqual([...png.subarray(0, 33)]);
    expect([...out.subarray(out.length - 12)]).toEqual([...png.subarray(33)]);
    const chunks: [string, string][] = [],
      view = new DataView(out.buffer);
    for (let at = 33; at < out.length - 12; ) {
      const n = view.getUint32(at),
        body = out.subarray(at + 4, at + 8 + n);
      expect(view.getUint32(at + 8 + n)).toBe(crc32(body));
      const text = new TextDecoder().decode(body.subarray(4)),
        [key] = text.split("\0");
      chunks.push([key, text.slice(key.length + 5)]);
      at += 12 + n;
    }
    expect(chunks).toEqual([
      ["Title", "π⁰ · Run 1"],
      ["Software", "Ember"],
    ]); // empty fields are left out
  });
});
