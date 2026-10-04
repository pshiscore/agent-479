import { describe, expect, it, vi } from "vitest";
import { cronDisabledResponse, cronEnabled } from "./cron-enabled";

describe("cronEnabled", () => {
  it("is on only for exactly \"true\"", () => {
    expect(cronEnabled("true")).toBe(true);
    for (const v of [undefined, "", "false", "TRUE", "1", "yes"]) expect(cronEnabled(v)).toBe(false);
  });
  it("logs 'disabled' and answers without running anything", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = cronDisabledResponse("fetch");
    expect(await res.json()).toEqual({ job: "fetch", disabled: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("cron fetch: disabled"));
    log.mockRestore();
  });
});
