import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoogleReviews } from "./google-reviews";

describe("GoogleReviews", () => {
  it("renders only our button: no Google script, element, or request before a tap", () => {
    const html = renderToStaticMarkup(<GoogleReviews googlePlaceId="ChIJC8HakaIRkFQRiOgkgdHmqkk" browserKey="test-key" />);
    expect(html).toContain("Show Google ratings and reviews");
    expect(html).not.toMatch(/googleapis|gmp-place|<script|test-key|ChIJ/);
  });
});
