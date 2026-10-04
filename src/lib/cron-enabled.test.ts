import { describe, expect, it, vi } from "vitest";
import { cronDisabledResponse, cronEnabled } from "./cron-enabled";

describe("cronEnabled", () => {
  it("is on for \"true\" however it was typed, and off for anything else", () => {
    for (const v of ["true", "TRUE", "True", " true ", '"true"', "'true'", "true\n"]) expect(cronEnabled(v)).toBe(true);
    for (const v of [undefined, "", "false", "1", "yes", "truthy", '"false"']) expect(cronEnabled(v)).toBe(false);
  });
  it("logs 'disabled' and answers without running anything", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = cronDisabledResponse("fetch", "flase");
    expect(await res.json()).toEqual({ job: "fetch", disabled: true });
    expect(log).toHaveBeenCalledWith('cron fetch: disabled (CRON_ENABLED is "flase", not "true")');
    cronDisabledResponse("fetch", undefined);
    expect(log).toHaveBeenLastCalledWith('cron fetch: disabled (CRON_ENABLED is unset, not "true")');
    log.mockRestore();
  });
});
