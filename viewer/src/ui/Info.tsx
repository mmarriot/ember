// Descriptions on request. The page itself carries names and numbers; what something is, and how a number is
// counted, is one click away: a small "i" next to it (or the word itself, where it is a tag) opens a pop-up. One pop-up
// at a time, placed under what opened it and kept inside the window; a press elsewhere or Esc closes it.
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** The open pop-up: where it was opened from, and its content, rendered on every update (it may hold controls). */
export const popover = signal<{ owner: Element; at: DOMRect; title?: string; body: () => ComponentChildren } | null>(null);

/** Open the pop-up from the element clicked, or close it if it is that element's. */
export function togglePopover(e: Event, body: () => ComponentChildren, title?: string) {
  e.preventDefault();
  e.stopPropagation();
  const owner = e.currentTarget as Element;
  popover.value = popover.peek()?.owner === owner ? null : { owner, at: owner.getBoundingClientRect(), title, body };
}

/** The "i" that explains what is next to it. */
export function Info({ title, children }: { title: string; children: ComponentChildren }) {
  return <button class="info" aria-label={`What is this: ${title}`} title="What is this?" onClick={(e) => togglePopover(e, () => children, title)}>i</button>;
}

export function Popover() {
  const p = popover.value, ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!p || !el) return;
    const w = el.offsetWidth, h = el.offsetHeight, below = p.at.bottom + 6;
    el.style.left = `${Math.max(8, Math.min(p.at.left, innerWidth - w - 8))}px`;
    el.style.top = `${below + h > innerHeight - 8 ? Math.max(8, p.at.top - h - 6) : below}px`;
    el.style.visibility = "visible";
    const away = (e: PointerEvent) => { if (!el.contains(e.target as Node) && !p.owner.contains(e.target as Node)) popover.value = null; };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [p]);
  if (!p) return null;
  return <div class="popover" role="dialog" aria-label={p.title} ref={ref}>{p.title && <h4>{p.title}</h4>}{p.body()}</div>;
}
