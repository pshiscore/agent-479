import { describe, expect, it } from "vitest";
import { isTicketingUrl } from "./ticketing";

describe("isTicketingUrl", () => {
  it("accepts https links on ticketing providers and their subdomains", () => {
    expect(isTicketingUrl("https://www.ticketmaster.com/event/0C00630FD8A54C2E")).toBe(true);
    expect(isTicketingUrl("https://concerts.livenation.com/x/event/1")).toBe(true);
    expect(isTicketingUrl("https://www.eventbrite.com/e/123")).toBe(true);
  });
  it("rejects venue sites, look-alike domains, plain http, and junk", () => {
    expect(isTicketingUrl("https://www.fayetteville-ar.gov/Calendar.aspx?EID=1")).toBe(false);
    expect(isTicketingUrl("https://ticketmaster.com.evil.example/e")).toBe(false);
    expect(isTicketingUrl("https://notticketmaster.com/e")).toBe(false);
    expect(isTicketingUrl("http://www.ticketmaster.com/event/1")).toBe(false);
    expect(isTicketingUrl("not a url")).toBe(false);
    expect(isTicketingUrl(null)).toBe(false);
  });
});
