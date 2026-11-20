// Small shared UI pieces: tabs, icons, modal dialog, notifications.
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";
import { dialog, toasts } from "../model/store";

/** Tabs named "Name" or "Name · count". The chosen one is remembered by name, so it stays chosen as counts change
 *  and other tabs come and go; while it is absent, the first is shown. `open`: a tab to choose from outside, each time
 *  a new object is passed (if there is such a tab). */
export function Tabs({ tabs, open }: { tabs: [string, () => ComponentChildren][]; open?: { name: string } | null }) {
  const id = (name: string) => name.split(" · ")[0];
  const [chosen, choose] = useState("");
  useEffect(() => {
    if (open && tabs.some(([name]) => id(name) === open.name)) choose(open.name);
  }, [open]);
  const current = tabs.find(([name]) => id(name) === chosen) ?? tabs[0];
  return (
    <div class="tabs">
      <div class="tablist" role="tablist">
        {tabs.map((tab) => (
          <button
            role="tab"
            aria-selected={tab === current}
            class={tab === current ? "tab active" : "tab"}
            onClick={() => choose(id(tab[0]))}
          >
            {tab[0]}
          </button>
        ))}
      </div>
      <div class="tabpanel" role="tabpanel">
        {current[1]()}
      </div>
    </div>
  );
}

/** While `open`, call `close` on a press anywhere outside the element of `ref` (a menu, a panel). A hook: it adds a
 *  document listener when `open` turns true, and removes it when `open` turns false or the component goes. */
export function usePressOutside(ref: RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
}

const PATHS = {
  prev: "M15 18l-6-6 6-6",
  next: "M9 18l6-6-6-6",
  close: "M18 6L6 18M6 6l12 12",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01",
  share: "M4 12v7h16v-7M12 3v12M7 8l5-5 5 5",
  reset: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
  focus: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  play: "M7 4.5v15l12-7.5z",
  pause: "M8 5v14M16 5v14",
};
export const Icon = ({ name }: { name: keyof typeof PATHS }) => (
  <svg
    class="icon"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={PATHS[name]} />
  </svg>
);

export function Modal({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="backdrop" onClick={() => (dialog.value = null)}>
      <div class="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button class="icon-button" title="Close (Esc)" onClick={() => (dialog.value = null)}>
            <Icon name="close" />
          </button>
        </header>
        <div class="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts">
      {toasts.value.map((t) => (
        <div class={`toast toast-${t.kind}`} role="status">
          {t.text}
        </div>
      ))}
    </div>
  );
}
