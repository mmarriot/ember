// "Save picture…" (the menu): the view alone, as on screen, at 1x, 2x or 4x its size, with what a figure needs over
// it: the experiment's label and a caption (top left) and the colour key (top right, model/colour/key.ts). All of it is edited
// in a preview: the texts retyped, key lines renamed or left out, the text size, the label and the key dragged
// anywhere. The choices are remembered in this browser, so that a series of pictures looks the same. Saved as PNG (with
// what it shows and the link to it in its text fields), as SVG (the view as an image, the label and the key as text
// and shapes, to edit further), or copied to the clipboard. render/overlay.ts lays it out and draws it.
import { useEffect, useRef, useState } from "preact/hooks";
import { engine } from "../../control/scene";
import { isSimulation } from "../../model/site/about";
import { type KeyEntry, viewKey } from "../../model/colour/key";
import { bundle, opened, shownEntry, theme, toast, toggleTheme } from "../../model/store";
import { PALETTES } from "../../render/colour";
import {
  type Block,
  type BlockName,
  cssFont,
  drawBlocks,
  type Font,
  layout,
  type Overlay,
  svgParts,
  withText,
} from "../../render/overlay";
import { Swatch } from "../sidebar/Key";
import { shownTitle } from "../viewport/TitleBox";
import { Modal } from "../common/widgets";

const SCALES = [1, 2, 4];
/** Label qualifiers to pick from (any text can be typed). */
const QUALIFIERS = ["Phase-2 Simulation Private Work", "Simulation Private Work", "Private Work", "Preliminary"];

/** The choices remembered (localStorage "evd.picture"). `qualifier`: the label's italic text, per kind of data set
 *  (profile, simulation or data), so that Phase-2 simulation and Run 3 data each keep their own. `names`: key titles
 *  and lines renamed, `hidden`: those left out, by group id and their text in the view's key ("pair|in no object"),
 *  so that an edit holds for every event; a title left out leaves its lines. */
interface Choices {
  scale: number;
  label: boolean;
  experiment: string;
  qualifier: Record<string, string>;
  caption: boolean;
  key: boolean;
  text: number;
  panel: boolean;
  at: Partial<Record<BlockName, [number, number]>>;
  names: Record<string, string>;
  hidden: string[];
}
const DEFAULT: Choices = {
  scale: 2,
  label: true,
  experiment: "CMS",
  qualifier: {},
  caption: true,
  key: true,
  text: 13,
  panel: true,
  at: {},
  names: {},
  hidden: [],
};
const STORE = "evd.picture";
/** The default caption: the event, after the label's word for what the data are ("ttbar · Run 1 · LS 1 · Event 4"). */
const firstCaption = () => shownTitle().replace(/^(SIMULATION|DATA) · /, "");
function load(): Choices {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") };
  } catch {
    return DEFAULT;
  }
}
function remember(c: Choices) {
  try {
    localStorage.setItem(STORE, JSON.stringify(c));
  } catch {
    /* not remembered */
  }
}

/** The label's qualifier unless one was typed: what the data are, and that the picture is no approved result. */
const defaultQualifier = (profile: string | undefined, sim: boolean) =>
  `${sim ? `${profile === "phase2" ? "Phase-2 " : ""}Simulation ` : ""}Private Work`;

/** Width of a text in a font, as the canvas draws it (the SVG takes the same layout). */
let measurer: CanvasRenderingContext2D | null = null;
const measure = (text: string, f: Font) => {
  measurer ??= document.createElement("canvas").getContext("2d")!;
  measurer.font = cssFont(f);
  return measurer.measureText(text).width;
};

function download(blob: Blob, name: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const blobOf = (c: HTMLCanvasElement) =>
  new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("no PNG"))), "image/png"));
const dataUrl = (b: Blob) =>
  new Promise<string>((ok) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.readAsDataURL(b);
  });

export function PictureDialog() {
  const [c, setChoices] = useState(load),
    b = bundle.value,
    e = shownEntry.value,
    o = opened.value;
  const set = (p: Partial<Choices>, keep = true) => {
    const next = { ...c, ...p };
    setChoices(next);
    if (keep) remember(next);
  };
  const [caption, setCaption] = useState(firstCaption),
    [busy, setBusy] = useState(false);
  const sim = !!b && !!e && isSimulation(b.header, e.run),
    kind = `${b?.header.profile}|${sim}`,
    qualifier = c.qualifier[kind] ?? defaultQualifier(b?.header.profile, sim);
  const groups = viewKey.value,
    named = (id: string, text: string) => c.names[id] ?? text,
    shown = (id: string) => !c.hidden.includes(id);
  const overlay = (): Overlay => ({
    label: {
      bold: c.label ? c.experiment : "",
      italic: c.label ? qualifier : "",
      caption: c.caption ? caption.split("\n") : [],
    },
    key: c.key
      ? groups.map((g) => ({
          title: shown(`${g.id}|${g.title}`)
            ? [named(`${g.id}|${g.title}`, g.title), g.about].filter(Boolean).join(": ")
            : "",
          entries: g.entries
            .filter((x) => shown(`${g.id}|${x.label}`))
            .map((x) => ({ ...x, label: named(`${g.id}|${x.label}`, x.label) })),
        }))
      : undefined,
    text: c.text,
    panel: c.panel,
    at: c.at,
    ink: getComputedStyle(document.documentElement).getPropertyValue("--text").trim(),
    background: `#${PALETTES[theme.value].background.toString(16).padStart(6, "0")}`,
  });

  // The preview: the view drawn once at its size on screen (again when the theme changes), the overlay over it at
  // every change. Its blocks are kept for dragging.
  const [view, setView] = useState<HTMLCanvasElement | null>(null),
    preview = useRef<HTMLCanvasElement>(null),
    blocks = useRef<Block[]>([]),
    drag = useRef<{ name: BlockName; dx: number; dy: number } | null>(null);
  const draw = () => {
    const p = preview.current,
      v = view;
    if (!p || !v) return;
    if (p.width !== v.width || p.height !== v.height) [p.width, p.height] = [v.width, v.height]; // else no new buffer
    const g = p.getContext("2d")!,
      ov = overlay();
    g.drawImage(v, 0, 0);
    drawBlocks(g, (blocks.current = layout(ov, v.width, v.height, 1, measure)), ov);
  };
  useEffect(() => setView(engine?.picture(1) ?? null), [theme.value]);
  useEffect(draw);
  const at = (ev: PointerEvent) => {
    const p = preview.current!,
      r = p.getBoundingClientRect();
    return [((ev.clientX - r.left) * p.width) / r.width, ((ev.clientY - r.top) * p.height) / r.height];
  };

  // Saving: the view drawn again at the size chosen, the overlay laid out for that size.
  const meta = () => ({
    Title: shownTitle(),
    Description: c.caption ? caption.replace(/\n/g, " · ") : "",
    Source: o?.local ? `${o.title} (a local file)` : location.href,
    Software: "Ember",
  });
  const name = (ext: string) => (e ? `ember_${e.run}_${e.lumi}_${e.event}.${ext}` : `ember.${ext}`);
  const render = () => {
    const v = engine?.picture(c.scale);
    if (!v) throw new Error("The graphics card cannot draw a picture this large: choose a smaller size");
    return { v, ov: overlay() };
  };
  const png = async () => {
    const { v, ov } = render();
    drawBlocks(v.getContext("2d")!, layout(ov, v.width, v.height, c.scale, measure), ov);
    return withText(await blobOf(v), meta());
  };
  const svg = async () => {
    const { v, ov } = render(),
      m = meta();
    const [head, tail] = svgParts(layout(ov, v.width, v.height, c.scale, measure), ov, [v.width, v.height, c.scale], {
      title: m.Title,
      desc: [m.Description, m.Source].filter(Boolean).join(". "),
    });
    return new Blob([head, await dataUrl(await blobOf(v)), tail], { type: "image/svg+xml" });
  };
  const failed = (err: Error) => toast(err.message || "The picture could not be made", "error");
  // Drawing the view again holds the page (seconds for a big event): say so first, with the buttons off, and start
  // once the browser has shown it (a timer set in the next frame runs after its paint).
  const save = (make: () => Promise<Blob>, ext: string) => () => {
    setBusy(true);
    requestAnimationFrame(() =>
      setTimeout(() =>
        make()
          .then((x) => download(x, name(ext)), failed)
          .finally(() => setBusy(false)),
      ),
    );
  };
  const copy = () => {
    setBusy(true); // not shown while the view is drawn: the clipboard is written within the click (Safari's rule)
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": png() })])
      .then(() => toast("Copied: paste it into a slide or a message"), failed)
      .finally(() => setBusy(false));
  };

  /** A key title or line in the editor (`id`: what its edits are kept under): kept or left out, and its text as it
   *  will read. (A function, not a component: one made anew at each render would be a new kind of element, and its
   *  field would lose the focus at each key.) */
  const line = (id: string, text: string, entry?: KeyEntry) => (
    <label class={entry ? "line" : "line title"}>
      <input
        type="checkbox"
        checked={shown(id)}
        onChange={() => set({ hidden: shown(id) ? [...c.hidden, id] : c.hidden.filter((h) => h !== id) })}
      />
      {entry && <Swatch e={entry} />}
      <input
        value={named(id, text)}
        placeholder={entry ? "" : "no title"}
        onInput={(ev) => {
          const v = (ev.target as HTMLInputElement).value,
            { [id]: _, ...rest } = c.names;
          set({ names: v === text ? rest : { ...rest, [id]: v } });
        }}
      />
    </label>
  );
  const check = (k: "label" | "caption" | "key" | "panel") => (
    <input type="checkbox" checked={c[k]} onChange={() => set({ [k]: !c[k] })} />
  );
  const w = view?.width ?? 0,
    h = view?.height ?? 0;

  return (
    <Modal title="Save picture" wide>
      {!view && <p class="muted">Drawing the view…</p>}
      <canvas
        ref={preview}
        class="picture-preview"
        aria-label="Preview: drag the label or the key to move it"
        onPointerDown={(ev) => {
          const [x, y] = at(ev),
            hit = [...blocks.current]
              .reverse()
              .find(({ box: [bx, by, bw, bh] }) => x >= bx && x <= bx + bw && y >= by && y <= by + bh);
          if (!hit) return;
          drag.current = { name: hit.name, dx: x - hit.box[0], dy: y - hit.box[1] };
          (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
        }}
        onPointerMove={(ev) => {
          const d = drag.current;
          if (!d) return;
          const [x, y] = at(ev);
          set({ at: { ...c.at, [d.name]: [(x - d.dx) / w, (y - d.dy) / h] } }, false); // remembered on release
        }}
        onLostPointerCapture={() => {
          // after a release, and after a cancel (touch), which has none
          if (drag.current) remember(c);
          drag.current = null;
        }}
      />
      <p class="hint">
        Drag the label or the key to move it. Your choices are kept for the next picture.{" "}
        {theme.value === "dark" && (
          <button class="link" onClick={toggleTheme}>
            White background (light theme)
          </button>
        )}
      </p>
      <div class="picture-actions">
        <div class="segmented picture-size" role="group" aria-label="Size">
          {SCALES.map((s) => (
            <button class={c.scale === s ? "on" : ""} onClick={() => set({ scale: s })}>
              {s}× <small>{`${w * s} × ${h * s}`}</small>
            </button>
          ))}
        </div>
        <button class="primary" onClick={save(png, "png")} disabled={!e || busy}>
          {busy ? "Saving…" : "Save PNG"}
        </button>
        <button
          onClick={save(svg, "svg")}
          disabled={!e || busy}
          title="The label and the key as text, over the view: to edit, or as PDF with rsvg-convert -f pdf"
        >
          Save SVG
        </button>
        {"ClipboardItem" in window && (
          <button onClick={copy} disabled={!e || busy}>
            Copy
          </button>
        )}
        <button
          class="link"
          onClick={() => {
            set(DEFAULT);
            setCaption(firstCaption());
          }}
          title="Back to the default label, caption, key and places"
        >
          Reset
        </button>
      </div>
      <div class="picture-form">
        <fieldset>
          <legend>Label</legend>
          <label class="line">
            {check("label")}
            <input
              class="experiment"
              value={c.experiment}
              aria-label="Experiment (bold)"
              onInput={(ev) => set({ experiment: (ev.target as HTMLInputElement).value })}
            />
            <input
              value={qualifier}
              list="picture-qualifiers"
              aria-label="Qualifier (italic)"
              onInput={(ev) => set({ qualifier: { ...c.qualifier, [kind]: (ev.target as HTMLInputElement).value } })}
            />
          </label>
          <datalist id="picture-qualifiers">
            {QUALIFIERS.map((q) => (
              <option value={q} />
            ))}
          </datalist>
          <label class="line">{check("caption")} Caption, one line each:</label>
          <textarea rows={2} value={caption} onInput={(ev) => setCaption((ev.target as HTMLTextAreaElement).value)} />
          <label class="line">
            Text size
            <input
              type="range"
              min={8}
              max={32}
              value={c.text}
              onInput={(ev) => set({ text: Number((ev.target as HTMLInputElement).value) })}
            />
          </label>
          <label class="line">{check("panel")} Panel behind the text</label>
        </fieldset>
        <fieldset>
          <legend>
            <label>{check("key")} Colour key</label>
          </legend>
          {!groups.length && <p class="muted">Nothing in this view has a key.</p>}
          {groups.map((g) => (
            <div class="group">
              {line(`${g.id}|${g.title}`, g.title)}
              {g.entries.map((x) => line(`${g.id}|${x.label}`, x.label, x))}
            </div>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}
