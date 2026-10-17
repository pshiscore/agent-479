import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { submissionFacts, submissionSchema } from "./submit";
import { checkToken, issueToken, MAX_AGE_MS, MIN_FILL_MS } from "./token";

describe("token", () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
  });
  afterEach(() => {
    process.env.CRON_SECRET = saved;
  });

  it("accepts a form filled at human speed within a day", () => {
    const t0 = 1_800_000_000_000;
    const token = issueToken(t0)!;
    expect(checkToken(token, t0 + MIN_FILL_MS - 1)).toBe("too_fast");
    expect(checkToken(token, t0 + 30_000)).toBe("ok");
    expect(checkToken(token, t0 + MAX_AGE_MS + 1)).toBe("expired");
  });

  it("refuses forged or mangled tokens, and everything when no secret is set", () => {
    const t0 = 1_800_000_000_000;
    const [, mac] = issueToken(t0)!.split(".");
    expect(checkToken(`${t0 - 60_000}.${mac}`, t0)).toBe("invalid");
    expect(checkToken("nonsense", t0)).toBe("invalid");
    delete process.env.CRON_SECRET;
    expect(issueToken(t0)).toBeNull();
    expect(checkToken(`${t0}.${mac}`, t0 + 30_000)).toBe("unavailable");
  });
});

const base = { title: "Harvest Hoedown", date: "2026-11-07", startTime: "", endDate: "", endTime: "", place: "Town Square, 1 Main St", city: "Prairie Grove", eventUrl: "https://example.org/hoedown", free: "yes", organizer: "", email: "Someone@Example.org", note: "" } as const;

describe("submission facts", () => {
  it("a date without a time is all day; a multi-day event ends at the next midnight", () => {
    const one = submissionFacts(submissionSchema.parse(base));
    expect(one).toMatchObject({ allDay: true, startAt: "2026-11-07T06:00:00.000Z", endAt: null, isFree: true, venueId: null, categoryId: null, moreInfoUrl: "https://example.org/hoedown" });
    const two = submissionFacts(submissionSchema.parse({ ...base, endDate: "2026-11-08" }));
    expect(two).toMatchObject({ allDay: true, endAt: "2026-11-09T06:00:00.000Z" });
  });

  it("times are Chicago wall times", () => {
    expect(submissionFacts(submissionSchema.parse({ ...base, startTime: "18:30", endTime: "21:00", free: "unknown" }))).toMatchObject({
      allDay: false,
      startAt: "2026-11-08T00:30:00.000Z",
      endAt: "2026-11-08T03:00:00.000Z",
      isFree: null,
    });
  });

  it("validates what people type", () => {
    expect(submissionSchema.parse(base).email).toBe("someone@example.org");
    const bad = submissionSchema.safeParse({ ...base, eventUrl: "http://example.org", endTime: "20:00", email: "nope" });
    const paths = bad.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["eventUrl", "endTime", "email"]));
  });
});
