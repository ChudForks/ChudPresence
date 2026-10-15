# Roblox V2

Version 1.1.0 shows browser activity through declarative page rules, with no
Roblox adapter, package JavaScript or network requests. Reload the updated
Chromium lab extension, then import `metadata.json`, `activity.json` and
`icon.png` through Activity Library → Developer → Load local Activity.
Approve the Roblox origins and extraction review. Local catalog changes reach
Discover after repository publication.
When updating from 1.0.0, reload the extension first and reimport all three
package files to approve 1.1.0. Reloading alone retains the old installed JSON.

| Page | Presence details |
| --- | --- |
| Roblox landing page or Home | Browsing home |
| Discover, Charts, chart categories or the legacy Games directory | Browsing charts |
| Marketplace or a catalog item | Browsing marketplace |
| Robux | Browsing Robux |
| Roblox Plus | Browsing Roblox Plus |
| Profile | Browsing profiles |
| Friends | Browsing friends |
| Avatar | Browsing avatar |
| Inventory | Browsing inventory |
| Trades | Browsing trades |
| Communities or a community page | Browsing communities |
| Messages | Browsing messages |
| Settings | Browsing settings |
| Gift cards | Browsing gift cards |
| Experience detail page | Viewing: Brookhaven 🏡RP |

The experience name is the visible `h1.game-name` inside `#game-detail-page`,
preserving the site's punctuation and emoji. The URL slug is used only to match
the route. Missing, hidden or rejected headings clear presence; recommended
games and descriptions are never title fallbacks. About, Store and Servers tabs
on the same experience keep its viewing status. Clicking Play does not establish
whether the native Roblox client is running, so this package continues to
describe the browser page.

All modes use the name Roblox, static official Roblox icon artwork and elapsed
time for the visible page session. The second status line is omitted. Normal
artwork, timer and status preferences apply. Changing route, experience ID or
title resets elapsed time; tracking query changes and same-page fragments do
not. Hidden tabs, unsupported routes and document exit clear activity through
the normal page lifecycle.

Supported hosts are `www.roblox.com` and `roblox.com`. Homepage support covers
`/` and `/home`; discovery covers `/discover`, `/charts`, one chart category and
the legacy `/games` directory. Charts waits for its visible
`#game-carousel-web-app` container. Marketplace covers `/catalog` and numeric
catalog-item paths; Robux covers `/upgrades/robux`. Sidebar routes cover `/plus`,
`/users/profile`, `/users/friends`, `/my/avatar`, `/users/inventory`, `/trades`,
`/communities`, `/my/messages`, `/my/account`, `/giftcards-us` and `/giftcards`.
Numeric profile/friends/inventory paths and numeric community detail paths are
also supported. Experience paths accept a numeric ID and an optional single
slug. Trailing slashes are supported. Fragments used by Messages, Friends,
Inventory and Settings keep the section's label without reading the selected
content. Localized prefixes, checkout/payment routes, Create/Creator Dashboard,
external Newsroom/official-store sites and other undeclared paths are outside
this version. Origin permission covers the Roblox site, while the collector
and worker enforce the declared routes.

Browsing routes use approved literal titles and skip DOM title extraction.
Only the public experience heading is read on experience routes. Profiles,
Messages, Settings, Trades and the other browsing sections report a literal
section name, without reading their contents. No account names, friend lists,
message bodies, balances, inventory items, search drafts, chat, descriptions,
player count, thumbnails, site scripts or tracking parameters enter reports.
Presence artwork and the
package PNG use Roblox's official
[touch icon](https://images.rbxcdn.com/905bd722ee0a6ceda3caacde54c0b081.png).

Read-only inspection verified the public landing container, signed-in Home and
sidebar URLs, Charts container, Marketplace and Robux layouts, Roblox Plus and
gift-card containers, Discover-to-Charts redirect and Brookhaven detail heading.
Unit tests and isolated real-DOM fixtures cover route matching, each browsing
status, scoped collection, elapsed time, output validation and Discord payload
formatting. Installed-extension and Discord publication still require importing
the package and checking a live session.
