# Crystal Bridges and the Momentary: permission request

One email covers both. Their shared terms of use
(<https://crystalbridges.org/terms-and-conditions-of-use>) prohibit automated
access and links to any page other than the homepage without prior written
consent, so we need **both** permissions in writing.

**To:** media@themomentary.org (the Momentary contact page lists this for media
inquiries)
**CC:** info@crystalbridges.org
**From:** your personal email, with **Reply-To: bot@479.guide** (that address
forwards to you; Cloudflare routing only receives, so send from your own
account)
**Fill in before sending:** `[Your name]`, `[phone, optional]`

---

**Subject:** Permission to list Crystal Bridges and Momentary events on a new NWA events calendar

Hello,

I'm [Your name], a Northwest Arkansas resident building **479 Guide**
(<https://479.guide>), a free local events calendar and weekly "weekend
picks" digest for Bentonville, Rogers, Springdale, Fayetteville, and Bella
Vista.

Crystal Bridges and the Momentary host some of the best events in the region,
and I'd like to include them. Your website's terms of use ask for prior
written consent for two things this would involve, so I'm asking first.

**What we would show for each event:**
- Title, date and time, location (e.g., the Momentary's Tower), and price or "free"
- A one-sentence description we write ourselves. We won't copy your text,
  images, or logos.
- A link to the event's page on your site for details and tickets

**The two permissions we'd need:**
1. **Linking directly to individual event pages** on crystalbridges.org and
   themomentary.org, rather than only to your homepages.
2. **Reading your public event listings automatically**, once a day, at a
   very low rate. Our reader, Agent479Bot, identifies itself with a contact address;
   what it reads and how to stop it are at <https://479.guide/bot>.
   If you have a feed (iCal/ICS, RSS, or a partner export), we'd much rather use that.

Is there any attribution or wording you'd like, or any type of event you'd
prefer we not list?

To be upfront: the project is a non-commercial hobby today. I may later add a
clearly labeled local sponsor to cover hosting costs. Sponsored content would
always be kept separate from event listings. If that would change your answer,
please tell me.

If you ever want a listing corrected or removed, one email to bot@479.guide
will do it. The site isn't public yet; I'm glad to send you a preview login
before anything goes live.

Thank you,
[Your name]
479 Guide · <https://479.guide> · bot@479.guide
[phone, optional]

---

## After a reply

- Record the date and exact scope of permission in `terms_notes` for **both**
  sources (`crystal-bridges`, `the-momentary`). The two permissions are
  separate: deep linking can be approved without automated access.
- **Linking allowed:** remove both domains from the homepage-only link policy.
- **Automated access allowed:** enable the sources. Build step 11 builds the
  fetchers.
- **No, or no reply:** keep both disabled and keep the homepage-only link policy.
