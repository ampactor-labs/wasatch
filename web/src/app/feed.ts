// The day's log of captions, as a model the screen draws: newest first,
// kept for the whole listening session. Cards that arrive while the reader
// has scrolled away from now wait in a queue, so nothing moves under their
// eyes; a "N new" pill brings them back. Pure: no DOM, so it's tested in
// Node (feed.test.ts).

import type { Caption, Family } from "./captions.ts";

/** A caption as the feed keeps it. */
export interface Card extends Caption {
  /** Unique within the session, in arrival order. */
  id: number;
}

/** The families worth announcing to a screen reader as they arrive (at
 * most one every `ANNOUNCE_MS`): the rest are there to read, not to hear. */
const NOTABLE: ReadonlySet<Family> = new Set<Family>(["harmony", "quake", "service", "alert", "frontrunner", "theme", "road", "storm", "plane"]);
export const ANNOUNCE_MS = 30_000;

/** How many cards a session keeps; the oldest go first. */
export const KEEP = 1500;

export class Feed {
  /** Newest first. */
  readonly cards: Card[] = [];
  /** Arrived while the reader was away from now, newest first. */
  readonly waiting: Card[] = [];
  private nextId = 1;
  private atNow = true;
  private lastAnnounced = Number.NEGATIVE_INFINITY;
  private readonly introduced = new Set<Family>();

  /** Whether the reader is at now (the top of the feed). */
  get following(): boolean {
    return this.atNow;
  }

  /** A caption arrives. Returns the card, whether it went straight in (at
   * now) or waits, and what to announce, if anything. Each family's intro
   * is shown once a session, on its first card. */
  add(c: Caption, now: number): { card: Card; shown: boolean; announce: string | null } {
    const intro = this.introduced.has(c.family) ? undefined : c.intro;
    this.introduced.add(c.family);
    const card: Card = { ...c, intro, id: this.nextId++ };
    let announce: string | null = null;
    if (NOTABLE.has(c.family) && now - this.lastAnnounced >= ANNOUNCE_MS) {
      announce = c.text;
      this.lastAnnounced = now;
    }
    if (this.atNow) {
      this.cards.unshift(card);
      this.trim();
      return { card, shown: true, announce };
    }
    this.waiting.unshift(card);
    return { card, shown: false, announce };
  }

  /** The reader left now (scrolled down) or came back to it. Coming back
   * hands over what waited, newest first, to be put on top. */
  follow(atNow: boolean): Card[] {
    this.atNow = atNow;
    return atNow ? this.flush() : [];
  }

  /** Put what waited on top; returns it, newest first. */
  flush(): Card[] {
    const came = this.waiting.splice(0);
    this.cards.unshift(...came);
    this.trim();
    return came;
  }

  /** The newest card shown. */
  latest(): Card | undefined {
    return this.cards[0];
  }

  /** Cards dropped off the end, oldest first, for the view to remove. */
  private dropped: number[] = [];
  takeDropped(): number[] {
    return this.dropped.splice(0);
  }

  private trim(): void {
    while (this.cards.length > KEEP) this.dropped.push(this.cards.pop()!.id);
  }
}
