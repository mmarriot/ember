// What a saved picture adds over the view (ui/Picture.tsx): the experiment's label with lines of caption under it, and
// the colour key (model/key.ts). Laid out once as plain shapes and text in two blocks, then drawn onto the picture's
// canvas (PNG) or written as SVG elements over the view's image, so that both formats look the same and the SVG's text
// stays text. Sizes are in units of the text size, so a picture at 4x is the one at 1x, only sharper.
import type { KeyGroup } from "../model/key";

/** What to draw over the view. `at`: each block's top left as a fraction of the picture's size; null: its corner
 *  (the label top left, the key top right). `text`: the caption's text size in CSS pixels; `panel`: a panel of the
 *  view's background behind each block, so the text reads over hits. */
export interface Overlay {
  label?: { bold: string; italic: string; caption: string[] };
  key?: Omit<KeyGroup, "id">[];
  text: number;
  panel: boolean;
  at: Partial<Record<BlockName, [number, number]>>;
  ink: string;
  background: string;
}
export type BlockName = "label" | "key";
export type Box = [x: number, y: number, w: number, h: number];
export interface Font {
  size: number;
  bold?: boolean;
  italic?: boolean;
}
export type Shape =
  | { text: string; x: number; y: number; font: Font } // y: the baseline
  | { dot: string; x: number; y: number; r: number }
  | { ramp: readonly string[]; box: Box };
export interface Block {
  name: BlockName;
  box: Box;
  shapes: Shape[];
}
/** The width of a text in pixels in a font (a canvas's measureText). */
export type Measure = (text: string, font: Font) => number;

// The CMS style's font (TeX Gyre Heros, Helvetica's) where there is one, else its metric twins.
const FAMILY = 'Helvetica, Arial, "Liberation Sans", "TeX Gyre Heros", sans-serif';
export const cssFont = (f: Font) => `${f.italic ? "italic " : ""}${f.bold ? 700 : 400} ${f.size}px ${FAMILY}`;
const LINE = 1.4, // line height, in text sizes
  PAD = 0.6, // a panel's padding
  MARGIN = 0.8, // a block's distance from the picture's edges, in its corner
  PANEL_ALPHA = 0.85;

/** The blocks over a picture of w x h pixels drawn `scale` times its size on screen. A block is clamped into the
 *  picture wherever it is put; empty blocks are left out. */
export function layout(o: Overlay, w: number, h: number, scale: number, measure: Measure): Block[] {
  const u = o.text * scale,
    blocks: Block[] = [];
  /** Stacks lines of shapes from the block's top left (0, 0); returns them and the block's size. */
  const stack = (lines: { height: number; shapes: (y: number) => Shape[]; width: number }[]) => {
    let y = PAD * u;
    const shapes = lines.flatMap((l) => {
      const s = l.shapes(y + 0.75 * l.height); // the baseline, about a cap height below the line's top
      y += l.height;
      return s;
    });
    return { shapes, size: [Math.max(...lines.map((l) => l.width)) + PAD * u, y + PAD * u - (LINE - 1) * u] };
  };
  const text = (s: string, font: Font, x = PAD * u) => ({
    height: LINE * font.size,
    width: x + measure(s, font),
    shapes: (y: number): Shape[] => [{ text: s, x, y, font }],
  });

  const lines = [];
  if (o.label?.bold || o.label?.italic) {
    // As the CMS style: the experiment in bold, then its qualifier ("Simulation Private Work") in italic.
    const b: Font = { size: 1.6 * u, bold: true },
      i: Font = { size: 1.25 * u, italic: true },
      gap = o.label.bold && o.label.italic ? 0.3 * u : 0,
      bw = o.label.bold ? measure(o.label.bold, b) : 0;
    lines.push({
      height: LINE * b.size,
      width: PAD * u + bw + gap + (o.label.italic ? measure(o.label.italic, i) : 0),
      shapes: (y: number): Shape[] => [
        { text: o.label!.bold, x: PAD * u, y, font: b },
        { text: o.label!.italic, x: PAD * u + bw + gap, y, font: i },
      ],
    });
  }
  for (const c of o.label?.caption ?? []) if (c) lines.push(text(c, { size: u }));
  if (lines.length) blocks.push(placed("label", stack(lines)));

  const groups = (o.key ?? []).filter((g) => g.entries.length);
  if (groups.length) {
    // One column: each group's title, then its lines, the group's labels lined up after its widest swatch.
    const r = 0.38 * u,
      swatchWidth = (e: KeyGroup["entries"][number]) => (e.ramp ? 3.5 * u : e.colours.length * 2.4 * r);
    const rows = groups.flatMap((g, k) => {
      const x = PAD * u + Math.max(...g.entries.map(swatchWidth)) + 0.5 * u;
      return [
        ...(g.title ? [text(g.title, { size: u, bold: true })] : []),
        ...g.entries.map((e) => ({
          ...text(e.label, { size: u }, x),
          shapes: (y: number): Shape[] => {
            const mid = y - 0.35 * u; // the text's middle
            return [
              ...(e.ramp
                ? [{ ramp: e.colours, box: [PAD * u, mid - 0.3 * u, 3.5 * u, 0.6 * u] as Box }]
                : e.colours.map((c, j) => ({
                    dot: c,
                    x: PAD * u + (2.4 * j + 1.2) * r,
                    y: mid,
                    r: e.small ? 0.6 * r : r,
                  }))),
              { text: e.label, x, y, font: { size: u } },
            ];
          },
        })),
        ...(k < groups.length - 1 ? [{ height: 0.4 * u, width: 0, shapes: () => [] }] : []),
      ];
    });
    blocks.push(placed("key", stack(rows)));
  }
  return blocks;

  /** The block moved to where it goes: its spot, else its corner; inside the picture. */
  function placed(name: BlockName, { shapes, size: [bw, bh] }: { shapes: Shape[]; size: number[] }): Block {
    const at = o.at[name],
      m = MARGIN * u;
    const x = Math.max(0, Math.min(w - bw, at ? at[0] * w : name === "label" ? m : w - bw - m));
    // In its corner, the key goes under the label where the two would meet (a narrow picture, large text).
    const label = !at && blocks.find((b) => b.name === "label")?.box,
      under = label && x < label[0] + label[2] && m < label[1] + label[3] ? label[1] + label[3] + m / 2 : m;
    const y = Math.max(0, Math.min(h - bh, at ? at[1] * h : under));
    return { name, box: [x, y, bw, bh], shapes: shapes.map((s) => moved(s, x, y)) };
  }
}

const moved = (s: Shape, dx: number, dy: number): Shape =>
  "box" in s ? { ...s, box: [s.box[0] + dx, s.box[1] + dy, s.box[2], s.box[3]] } : { ...s, x: s.x + dx, y: s.y + dy };

/** Draws the blocks onto a 2D canvas (the picture's, over the view). */
export function drawBlocks(g: CanvasRenderingContext2D, blocks: Block[], o: Overlay) {
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  for (const { box, shapes } of blocks) {
    if (o.panel) {
      g.globalAlpha = PANEL_ALPHA;
      g.fillStyle = o.background;
      g.fillRect(...box);
      g.globalAlpha = 1;
    }
    for (const s of shapes)
      if ("text" in s) {
        g.font = cssFont(s.font);
        g.fillStyle = o.ink;
        g.fillText(s.text, s.x, s.y);
      } else if ("dot" in s) {
        g.fillStyle = s.dot;
        g.beginPath();
        g.arc(s.x, s.y, s.r, 0, 2 * Math.PI);
        g.fill();
      } else {
        const grad = g.createLinearGradient(s.box[0], 0, s.box[0] + s.box[2], 0);
        s.ramp.forEach((c, i) => grad.addColorStop(i / (s.ramp.length - 1), c));
        g.fillStyle = grad;
        g.fillRect(...s.box);
      }
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const n = (v: number) => +v.toFixed(2);

/** The picture as SVG, in the two parts around the view's image address (a data: URL of tens of MB at 4x, which the
 *  caller puts between them in a Blob rather than in one string): the view as an image, then one group per block
 *  (id "label", "key") of text and shapes, which an editor moves and retypes as such. The document has the view's
 *  size on screen, and the w x h pixels drawn `scale` times that inside it. `meta`: title and description. */
export function svgParts(
  blocks: Block[],
  o: Overlay,
  [w, h, scale]: [number, number, number],
  meta: { title: string; desc: string },
) {
  const defs: string[] = [],
    body = blocks.map(({ name, box, shapes }) => {
      const panel = o.panel
        ? `<rect x="${n(box[0])}" y="${n(box[1])}" width="${n(box[2])}" height="${n(box[3])}" fill="${o.background}" fill-opacity="${PANEL_ALPHA}"/>`
        : "";
      const parts = shapes.map((s) => {
        if ("text" in s)
          return `<text x="${n(s.x)}" y="${n(s.y)}" font-size="${n(s.font.size)}"${s.font.bold ? ' font-weight="bold"' : ""}${s.font.italic ? ' font-style="italic"' : ""}>${esc(s.text)}</text>`;
        if ("dot" in s) return `<circle cx="${n(s.x)}" cy="${n(s.y)}" r="${n(s.r)}" fill="${s.dot}"/>`;
        const id = `ramp${defs.length}`;
        defs.push(
          `<linearGradient id="${id}">${s.ramp.map((c, i) => `<stop offset="${n(i / (s.ramp.length - 1))}" stop-color="${c}"/>`).join("")}</linearGradient>`,
        );
        return `<rect x="${n(s.box[0])}" y="${n(s.box[1])}" width="${n(s.box[2])}" height="${n(s.box[3])}" fill="url(#${id})"/>`;
      });
      return `<g id="${name}">${panel}${parts.join("")}</g>`;
    });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(w / scale)}" height="${n(h / scale)}" viewBox="0 0 ${w} ${h}">` +
      `<title>${esc(meta.title)}</title><desc>${esc(meta.desc)}</desc>` +
      (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
      `<image id="view" width="${w}" height="${h}" xlink:href="`,
    `"/><g font-family='${FAMILY}' fill="${o.ink}">${body.join("")}</g></svg>`,
  ] as const;
}

// PNG text: what the picture is and where it comes from, as iTXt chunks (UTF-8) right after the header chunk.
const CRC = Array.from({ length: 256 }, (_, k) => {
  let c = k;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The PNG with text fields (e.g. Title, Source) added after its 33-byte signature and header chunk. The image
 *  itself is not copied: the new Blob refers to slices of the old one. */
export function withText(png: Blob, fields: Record<string, string>): Blob {
  const enc = new TextEncoder();
  const chunks = Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => {
      // type, keyword, NUL, no compression (0, 0), no language tag nor translated keyword (NUL, NUL), the text
      const body = new Uint8Array([...enc.encode(`iTXt${k}`), 0, 0, 0, 0, 0, ...enc.encode(v)]),
        out = new Uint8Array(body.length + 8),
        view = new DataView(out.buffer);
      view.setUint32(0, body.length - 4);
      out.set(body, 4);
      view.setUint32(out.length - 4, crc32(body));
      return out;
    });
  return new Blob([png.slice(0, 33), ...chunks, png.slice(33)], { type: "image/png" });
}
