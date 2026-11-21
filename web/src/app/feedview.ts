// The feed on screen: the caption box as a scroller, newest on top. Each
// card goes in as one node (never a rebuild), so what you're reading and
// where you are stay put. Scrolled down, away from now, new cards wait
// above and a "N new ↑" pill brings them in; back at the top they arrive
// as they're played. On a phone the box keeps its height, so the map
// beside it never resizes.

import { esc } from "../art/util.ts";
import { receiptText } from "./captions.ts";
import { type Card, Feed } from "./feed.ts";
import { FAMILY_TOPIC } from "./lowdown.ts";

/** How close to the top counts as "at now", px. */
const AT_NOW_PX = 4;

export class FeedView {
  readonly feed = new Feed();
  private readonly scroller: HTMLElement;
  private readonly pill: HTMLButtonElement;
  private readonly say: HTMLElement;
  private readonly nodes = new Map<number, HTMLElement>();

  constructor(host: HTMLElement) {
    host.innerHTML = `<div class="feed">
        <button type="button" class="feed__new" hidden></button>
        <div class="feed__scroll" role="feed" aria-label="What the valley played"></div>
      </div>
      <p class="sr-only" aria-live="polite" aria-atomic="true"></p>`;
    this.scroller = host.querySelector<HTMLElement>(".feed__scroll")!;
    this.pill = host.querySelector<HTMLButtonElement>(".feed__new")!;
    this.say = host.querySelector<HTMLElement>(".sr-only")!;
    this.scroller.addEventListener("scroll", () => this.onScroll(), { passive: true });
    this.pill.addEventListener("click", () => this.toNow());
  }

  /** A caption arrives. */
  add(card: Parameters<Feed["add"]>[0]): void {
    const { card: c, shown, announce } = this.feed.add(card, performance.now());
    if (announce) this.say.textContent = announce;
    if (shown) this.prepend([c]);
    else this.showPill();
    for (const id of this.feed.takeDropped()) {
      this.nodes.get(id)?.remove();
      this.nodes.delete(id);
    }
  }

  /** The newest card shown, for the lock screen. */
  latest(): Card | undefined {
    return this.feed.latest();
  }

  private onScroll(): void {
    const atNow = this.scroller.scrollTop <= AT_NOW_PX;
    if (atNow === this.feed.following) return;
    const came = this.feed.follow(atNow);
    if (came.length) this.prepend(came);
    if (atNow) this.showPill();
  }

  /** Back to now: what waited goes on top, and the feed scrolls up. */
  private toNow(): void {
    const came = this.feed.follow(true);
    if (came.length) this.prepend(came);
    this.showPill();
    const smooth = this.scroller.scrollTop < 2 * this.scroller.clientHeight && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.scroller.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  }

  private showPill(): void {
    const n = this.feed.waiting.length;
    this.pill.hidden = n === 0;
    this.pill.textContent = `${n} new ↑`;
  }

  /** Put cards (newest first) on top; the one that was newest becomes a
   * row like the rest. */
  private prepend(cards: Card[]): void {
    const was = this.scroller.firstElementChild;
    if (was) {
      was.classList.replace("caption--new", "caption--old");
      was.classList.add("sign--small");
      was.querySelector(".caption__intro")?.remove();
    }
    const frag = document.createDocumentFragment();
    cards.forEach((c, i) => {
      const el = this.node(c, i === 0);
      this.nodes.set(c.id, el);
      frag.append(el);
    });
    this.scroller.prepend(frag);
  }

  private node(c: Card, newest: boolean): HTMLElement {
    const el = document.createElement("article");
    el.className = `sign sign--${c.receipt} caption ${newest ? "caption--new" : "sign--small caption--old"}`;
    el.dataset.topic = FAMILY_TOPIC[c.family] ?? "receipts";
    el.tabIndex = 0;
    el.innerHTML = `<p class="sign__line">${esc(c.text)}</p>${newest && c.intro ? `<p class="sign__line caption__intro">${esc(c.intro)}</p>` : ""}
      <span class="sign__receipt">${esc(receiptText(c))}</span>`;
    return el;
  }
}
