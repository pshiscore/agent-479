import { describe, expect, it } from "vitest";
import { isLocalScheduleDue, LOCAL_SCHEDULES, type LocalSchedule } from "./cron-guard";
import { chicagoParts } from "./time";

/** Every UTC firing of a "M H * * D" cron expression within [from, to). */
function firings(cron: string, from: Date, to: Date): Date[] {
  const [minute, hour, dom, month, dow] = cron.split(" ");
  expect([dom, month]).toEqual(["*", "*"]);
  const out: Date[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 86_400_000) {
    const day = new Date(t);
    if (day.getUTCDay() !== Number(dow)) continue;
    out.push(
      new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), Number(hour), Number(minute)),
      ),
    );
  }
  return out;
}

describe.each(Object.entries(LOCAL_SCHEDULES))("%s", (_name, schedule: LocalSchedule) => {
  it("does its work exactly once a week, at the right local time, all of 2026-2027", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2028-01-01T00:00:00Z");
    const due = schedule.crons
      .flatMap((cron) => firings(cron, from, to))
      .filter((t) => isLocalScheduleDue(schedule, t))
      .sort((a, b) => a.getTime() - b.getTime());

    // 104 or 105 weeks in the range; one run each, about 7 days apart.
    expect(due.length).toBeGreaterThanOrEqual(104);
    for (const t of due) {
      expect(chicagoParts(t)).toMatchObject({ weekday: schedule.weekday, hour: schedule.hour, minute: 0 });
    }
    for (let i = 1; i < due.length; i++) {
      const gapHours = (due[i].getTime() - due[i - 1].getTime()) / 3_600_000;
      expect([167, 168, 169]).toContain(gapHours);
    }
  });
});

describe("isLocalScheduleDue", () => {
  const draft = LOCAL_SCHEDULES.digestDraft;

  it("picks the CDT entry in October", () => {
    expect(isLocalScheduleDue(draft, new Date("2026-10-08T23:00:00Z"))).toBe(true);
    expect(isLocalScheduleDue(draft, new Date("2026-10-09T00:00:00Z"))).toBe(false);
  });

  it("picks the CST entry in December", () => {
    expect(isLocalScheduleDue(draft, new Date("2026-12-03T23:00:00Z"))).toBe(false);
    expect(isLocalScheduleDue(draft, new Date("2026-12-04T00:00:00Z"))).toBe(true);
  });

  it("tolerates a late cron start within the hour", () => {
    expect(isLocalScheduleDue(draft, new Date("2026-10-08T23:04:30Z"))).toBe(true);
  });
});
