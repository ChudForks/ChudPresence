# Generic feed example

This example uses Activity API V2 configuration `schemaVersion: 2` to read public
metadata and choose the largest visible native player in an explicitly selected
container. Replace its host, container and field selectors for your site before
loading the JSON files through the Activity Library. The static artwork and
button URLs must also be replaced or omitted. It is an authoring example and is
not included in the distributable activity catalog.

`fallback` supplies a literal only when the selected title node is missing.
Hidden or rejected nodes clear presence. `retainMetadata` keeps previously read
visible values when controls are removed, only for the same player, route and
native media source. Changing the source or selecting another player resets it.

See [the API contract](../../ACTIVITY_API_V2.md#reusable-capabilities-schemaversion-2)
for DOM media, transforms, integer episode fields and trusted named lookups.
