// Tap anything that comes from the valley, or says something about the
// music, and a toast says what it is and what the piece does with it. It
// fades after a few seconds; tapped, it opens the lowdown there.
//
// Anything with data-topic="<id>" explains itself (lowdown.ts).

import { esc } from "../art/util.ts";
import { isTopic, topic, type LowdownCtx, type TopicId } from "./lowdown.ts";

/** How long a toast stays up untouched. */
const SHOW_MS = 4500;

export class Explainer {
  private readonly el: HTMLElement;
  private timer = 0;
  private showing: TopicId | null = null;
  private held = false;
  private readonly ctx: () => LowdownCtx | null;
  private readonly openLowdown: (id: TopicId) => void;

  constructor(ctx: () => LowdownCtx | null, openLowdown: (id: TopicId) => void) {
    this.ctx = ctx;
    this.openLowdown = openLowdown;
    this.el = document.createElement("div");
    this.el.className = "toast";
    this.el.setAttribute("role", "status");
    this.el.setAttribute("aria-live", "polite");
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.el.addEventListener("pointerenter", () => this.hold(true));
    this.el.addEventListener("pointerleave", () => this.hold(false));
    this.el.addEventListener("focusin", () => this.hold(true));
    this.el.addEventListener("focusout", () => this.hold(false));
    document.addEventListener("click", (e) => this.click(e), true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.showing) this.hide();
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-topic]");
      // Buttons click on their own; signs and stickers need the key.
      if (target && target.tagName !== "BUTTON" && isTopic(target.dataset.topic)) {
        e.preventDefault();
        this.show(target.dataset.topic, target);
      }
    });
  }

  private click(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (this.el.contains(target)) {
      const id = this.showing;
      this.hide();
      if (id) this.openLowdown(id);
      return;
    }
    const term = target.closest<HTMLElement>("[data-topic]");
    if (term && isTopic(term.dataset.topic) && !target.closest("button:not([data-topic]), a, input")) {
      this.show(term.dataset.topic, term);
      return;
    }
    if (this.showing) this.hide();
  }

  private hold(on: boolean): void {
    this.held = on;
    clearTimeout(this.timer);
    if (!on && this.showing) this.timer = window.setTimeout(() => this.hide(), SHOW_MS);
  }

  /** Explain `id`, near `anchor`. */
  show(id: TopicId, anchor: HTMLElement): void {
    const t = topic(id);
    const c = this.ctx();
    const now = c && t.now ? t.now(c) : null;
    this.el.innerHTML = `<button type="button" class="toast__card">
        <span class="toast__title">${esc(t.title)}</span>
        ${now ? `<span class="toast__now">${esc(now.value)} <span class="toast__receipt">${esc(now.receipt)}</span></span>` : ""}
        <span class="toast__text">${esc(t.short)}</span>
        <span class="toast__more">The lowdown →</span>
      </button>`;
    this.el.hidden = false;
    this.showing = id;
    this.place(anchor);
    this.el.classList.remove("toast--on");
    void this.el.offsetWidth;
    this.el.classList.add("toast--on");
    clearTimeout(this.timer);
    if (!this.held) this.timer = window.setTimeout(() => this.hide(), SHOW_MS);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.showing = null;
    this.held = false;
    this.el.classList.remove("toast--on");
    window.setTimeout(() => {
      if (!this.showing) this.el.hidden = true;
    }, 200);
  }

  /** Below the anchor if there's room, above it if not, inside the screen. */
  private place(anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const gutter = 12;
    const width = Math.min(340, window.innerWidth - 2 * gutter);
    this.el.style.width = `${width}px`;
    const h = this.el.offsetHeight;
    const left = Math.max(gutter, Math.min(window.innerWidth - width - gutter, r.left + r.width / 2 - width / 2));
    const below = r.bottom + 8;
    const top = below + h <= window.innerHeight - gutter ? below : Math.max(gutter, r.top - 8 - h);
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }
}
