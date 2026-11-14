// The top bar's menu: every control of the view in one place, grouped, with its key and whether it is on. Many of
// them have no button of their own (labels, replay, next object, levels), so the menu is where they can be found.
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
  anchor,
  bundle,
  colourChoice,
  dialog,
  focus,
  focusBar,
  focusHistory,
  following,
  highlight,
  labelsOn,
  selection,
  stepEvent,
  stepFocusLevel,
  theme,
  toggleTheme,
  touring,
  truthColours,
  view,
} from "../model/store";
import { toggleLive } from "./live";
import { back, cross, nextDomain, nextObject, showWhole } from "./navigate";
import { stopTour, toggleTour } from "./tour";
import { engine, replayEvent, VIEWS } from "./Viewport";

/** Open or closed; Esc closes it first (App.tsx). */
export const menuOpen = signal(false);

type Item = { label: string; keys?: string; on?: boolean; off?: boolean; run: () => void };

export function Menu() {
  const ref = useRef<HTMLDivElement>(null),
    open = menuOpen.value;
  useEffect(() => {
    // a press outside closes it
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) menuOpen.value = false;
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const parts = (bundle.value?.header.domains?.length ?? 0) >= 2,
    f = focus.value;
  const levels = !!f && focusBar.value.some((l) => !l.always);
  const groups: [string, Item[]][] = [
    [
      "View",
      [
        ...VIEWS.map(
          ([v, name, key]): Item => ({ label: name, keys: key, on: view.value === v, run: () => (view.value = v) }),
        ),
        { label: "Show the whole event", keys: "Home", run: () => showWhole() },
        {
          label: "Zoom to the selection",
          keys: "F",
          off: !highlight.value,
          run: () => engine?.frame(highlight.value ?? undefined, true),
        },
        { label: "Labels", keys: "L", on: labelsOn.value, run: () => (labelsOn.value = !labelsOn.value) },
      ],
    ],
    [
      "Event",
      [
        { label: "Previous event", keys: "←", run: () => stepEvent(-1) },
        { label: "Next event", keys: "→", run: () => stepEvent(1) },
        ...(parts
          ? [
              { label: "Next part of the detector", keys: "D", run: () => nextDomain(1) },
              { label: "Previous part", keys: "⇧D", run: () => nextDomain(-1) },
            ]
          : []),
      ],
    ],
    [
      "Selection",
      [
        { label: "Next object, largest first", keys: "N", run: () => nextObject(1) },
        { label: "Previous object", keys: "⇧N", run: () => nextObject(-1) },
        { label: "Across to its truth or reco match", keys: "X", off: !selection.value, run: cross },
        {
          label: "Back to the previous object",
          keys: "B",
          off: !anchor.value && !focusHistory.value.length,
          run: back,
        },
        { label: "One level down", keys: "↓", off: !levels, run: () => stepFocusLevel(1) },
        { label: "One level up", keys: "↑", off: !levels, run: () => stepFocusLevel(-1) },
        {
          label: "Leave the selection",
          keys: "Esc",
          off: !selection.value,
          run: () => {
            selection.value = null;
            showWhole(true);
          },
        },
      ],
    ],
    [
      "Colours",
      truthColours.value
        ? [
            {
              label: "Reco: what was reconstructed",
              on: colourChoice.value === "reco",
              run: () => (colourChoice.value = "reco"),
            },
            {
              label: "Truth: what was really there",
              keys: "T",
              on: colourChoice.value === "truth",
              run: () => (colourChoice.value = "truth"),
            },
          ]
        : [],
    ],
    [
      "Play",
      [
        { label: "Replay the event, step by step", keys: "R", run: () => void replayEvent() },
        { label: "Tour, event after event", keys: "P", on: touring.value, run: toggleTour },
        { label: "Live: new data as it comes", on: following.value, run: toggleLive },
      ],
    ],
    [
      "",
      [
        { label: theme.value === "dark" ? "Light theme" : "Dark theme", run: toggleTheme },
        { label: "Help and every key", keys: "?", run: () => (dialog.value = "help") },
      ],
    ],
  ];
  return (
    <div class="menu" ref={ref}>
      <button
        class={open ? "menubutton on" : "menubutton"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Every control and its key"
        onClick={() => (menuOpen.value = !open)}
      >
        Menu <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div class="menupanel" role="menu">
          {groups
            .filter(([, items]) => items.length)
            .map(([name, items]) => (
              <div class="menugroup" role="group" aria-label={name || undefined}>
                {name && <div class="menuhead">{name}</div>}
                {items.map((it) => (
                  <button
                    role={it.on === undefined ? "menuitem" : "menuitemcheckbox"}
                    aria-checked={it.on}
                    class={it.on ? "menuitem on" : "menuitem"}
                    disabled={it.off}
                    onClick={() => {
                      menuOpen.value = false;
                      if (it.run !== toggleTour) stopTour();
                      it.run();
                    }}
                  >
                    <span class="check" aria-hidden="true">
                      {it.on ? "✓" : ""}
                    </span>
                    <span class="what">{it.label}</span>
                    {it.keys && <kbd>{it.keys}</kbd>}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
