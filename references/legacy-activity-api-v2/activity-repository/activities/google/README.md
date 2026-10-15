# Google V2

Version 1.0.1 uses declarative page activity rules, with no player or Google
adapter. Reload the updated Chromium lab 2.0.0 extension, then import
`metadata.json`, `activity.json` and `icon.png` through Activity Library's
Developer view and approve the declared Google origins and extraction review.
Local catalog changes appear in Discover only after repository publication.

| Page | Discord name | Details | State |
| --- | --- | --- | --- |
| Google homepage (no submitted query) | Google | Homepage | Omitted |
| Google Search / Web results | Google | Searching for : query | Visible result count and search time, when available |
| Google Images | Google Images | Searching for : query | Omitted |
| Google AI Mode | Google AI | Searching for : query | Omitted |

All modes use Playing, the official Google G artwork, the mode name for the
default compact status, and elapsed time for the current visible search session.
Artwork and timer preferences are honored. Changing query or mode, hiding the
tab, leaving the supported routes, or closing the page resets the timer.

Supported hosts are `www.google.com` and `google.com`. Search results require
`/search` and a submitted `q` query. Images supports `udm=2`, legacy `tbm=isch`,
and `/images?q=...`; AI Mode supports `udm=50`. Ordinary Search accepts absent
`udm` or `udm=14`. The homepage supports `/` and `/webhp` with no submitted query
or search mode, using the visible `#gbwa` Google apps container for readiness and
a static Homepage label. Other Google tabs, products, regional hosts, and AI
conversation follow-ups are outside this version.
Duplicate or contradictory mode/query parameters clear presence.

The collector reads only the declared `q` parameter and visible `#result-stats`
text within `#main`. It never reads a search input, an unsubmitted draft, an AI
response, account information, result descriptions, or image captions. The
submitted query can be shared with Discord when sharing is enabled; the normal
installation review explicitly describes that read. Tracking values and full
URLs are not reported, and image URLs remain static.

Google currently hides the result-count element in the inspected layout. Its
text is omitted while hidden, so the reference screenshot's count line is shown
only on layouts where Google actually renders it. No count is fabricated.

The PNG and presence artwork use Google's official
[Google G image](https://www.google.com/images/branding/googleg/2x/googleg_standard_color_128dp.png).
Unit tests, worker installation/restoration tests, and isolated Chromium fixtures
cover the package. Current Google page inspection verified the `#main` scope
and Images/AI route parameters. Installed-extension and Discord rendering still
require importing the package and checking a live session.
