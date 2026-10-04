import { describe, expect, it } from "vitest";
import { redactUrl } from "./redact";

describe("redactUrl", () => {
  it("redacts API keys and tokens in the query, keeping everything else", () => {
    expect(redactUrl("https://app.ticketmaster.com/discovery/v2/events.json?apikey=abc123&size=200&page=2")).toBe(
      "https://app.ticketmaster.com/discovery/v2/events.json?apikey=REDACTED&size=200&page=2",
    );
    expect(redactUrl("https://x.example/?api_key=a&token=b&q=jazz")).toBe("https://x.example/?api_key=REDACTED&token=REDACTED&q=jazz");
  });

  it("leaves URLs without secrets alone", () => {
    expect(redactUrl("https://www.rogersar.gov/common/modules/iCalendar/iCalendar.aspx?catID=28&feed=calendar")).toBe(
      "https://www.rogersar.gov/common/modules/iCalendar/iCalendar.aspx?catID=28&feed=calendar",
    );
  });

  it("still redacts strings that don't parse as URLs", () => {
    expect(redactUrl("/events.json?apikey=abc123&x=1")).toBe("/events.json?apikey=REDACTED&x=1");
  });
});
