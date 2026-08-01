import { describe, expect, test } from "vitest";
import { deadlineParts, registrationDeadline } from "../../src/lib/planner/deadline.js";

describe("registrationDeadline", () => {
  test("høst closes 15 September of its own year", () => {
    const d = registrationDeadline("26h", new Date(2026, 7, 1));
    expect(d?.word).toBe("15. september");
    expect(d?.date.getFullYear()).toBe(2026);
    expect(d?.date.getMonth()).toBe(8);
    expect(d?.date.getDate()).toBe(15);
    // 30 days of August left, plus 15 of September.
    expect(d?.daysLeft).toBe(45);
  });

  test("vår closes 1 February of its own year", () => {
    const d = registrationDeadline("27v", new Date(2027, 0, 20));
    expect(d?.word).toBe("1. februar");
    expect(d?.daysLeft).toBe(12);
  });

  test("the day itself is 0 days left, not passed", () => {
    // Late in the evening of the deadline: a student can still register, so the
    // line must still be there. Counting hours rather than calendar days would
    // have made this -1.
    const d = registrationDeadline("26h", new Date(2026, 8, 15, 23, 30));
    expect(d?.daysLeft).toBe(0);
  });

  test("a passed deadline says nothing at all", () => {
    // Not "0 dager igjen" and not "utløpt": the page still plans the term you
    // are in, and a permanent expired banner is chrome a student learns to
    // skip past.
    expect(registrationDeadline("26h", new Date(2026, 8, 16))).toBeNull();
  });

  test("an unparseable semester is null, never a guessed date", () => {
    expect(registrationDeadline("", new Date(2026, 0, 1))).toBeNull();
    expect(registrationDeadline("2026-host", new Date(2026, 0, 1))).toBeNull();
  });
});

describe("deadlineParts", () => {
  test("the date is handed back on its own so the caller can set it in ink", () => {
    const d = registrationDeadline("26h", new Date(2026, 7, 1));
    expect(d).not.toBeNull();
    if (!d) return;
    const parts = deadlineParts(d);
    expect(parts.before).toBe("Oppmelding stenger ");
    expect(parts.date).toBe("15. september");
    expect(parts.after).toBe(" — 45 dager igjen");
  });

  test("one day is singular, and the day itself is neither", () => {
    const one = registrationDeadline("26h", new Date(2026, 8, 14));
    expect(one && deadlineParts(one).after).toBe(" — 1 dag igjen");
    const today = registrationDeadline("26h", new Date(2026, 8, 15));
    expect(today && deadlineParts(today).after).toBe(" — i dag");
  });
});
