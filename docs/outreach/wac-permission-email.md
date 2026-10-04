# Walton Arts Center: permission request

**To:** Jennifer Wilson, Public Relations Director: jwilson@waltonartscenter.org
(listed on <https://waltonartscenter.org/media-resources/>)
**Fallback:** info@waltonartscenter.org
**From:** your personal email, with **Reply-To: bot@479.guide** (that address
forwards to you; Cloudflare routing only receives, so send from your own
account)
**Fill in before sending:** `[Your name]`, `[phone, optional]`.

---

**Subject:** Listing Walton Arts Center shows on a new NWA events calendar: may we?

Hi Jennifer,

I'm [Your name], a Northwest Arkansas resident building **479 Guide**
(<https://479.guide>), a free local events calendar and weekly "weekend
picks" digest covering Bentonville, Rogers, Springdale, Fayetteville, and
Bella Vista.

Walton Arts Center is one of the first places people look for something to do,
and I'd like to list your shows correctly. Before I include them, I wanted to ask
how you'd prefer we do it.

**What we would show for each performance:**
- Title, date and time, venue (e.g., Baum Walker Hall), and price range
- A link straight to your official event or ticket page. All ticket sales stay with you.
- A one-sentence description we write ourselves. We won't copy your text, and we
  won't use your images or logos unless you tell us that's welcome.

**My questions:**
1. Do you have a feed we could use, such as an iCal/ICS, RSS, or JSON
   calendar export, or a partner listing service?
2. If not, may we read your public online calendar once a day? Our automated
   reader, Agent479Bot, identifies itself with a contact address and runs at a
   very low rate. What it reads and how to stop it are at
   <https://479.guide/bot>.
3. Is there any attribution or wording you'd like us to use, or anything you'd
   rather we not show?

To be upfront: the project is a non-commercial hobby today. I may later add a
clearly labeled local sponsor to cover hosting costs. Sponsored content would
always be kept separate from event listings. If that would change your answer,
please tell me.

If you ever want a listing corrected or removed, one email to bot@479.guide
will do it. The site isn't public yet; I'm glad to send you a preview login
before anything goes live.

Thanks for your time and for everything WAC brings to the area.

Best,
[Your name]
479 Guide · <https://479.guide> · bot@479.guide
[phone, optional]

---

## After a reply

- **Yes, via a feed:** record the feed URL and the date and wording of their
  permission in `sources.terms_notes`, set `commercial_use_ok` to match their
  answer, and set `enabled = true`.
- **Yes, read the calendar:** same as above. Use their public calendar pages
  at 1 request per 2 seconds or slower, once a day. Don't use the undocumented
  `/api/Calendar` endpoint unless they say so.
- **No, or no reply:** keep the source disabled. WAC shows can still appear
  through other permitted sources, linking to WAC's own pages.
