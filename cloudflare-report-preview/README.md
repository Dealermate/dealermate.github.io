# Dealer Mate report link previews

A Cloudflare Worker that serves server-rendered Open Graph metadata for existing published vehicle reports. Clicking a preview opens the existing GitHub Pages viewer. No database migration or privileged key is required.

## Dashboard setup

1. Cloudflare dashboard → Workers & Pages → Create application → Create Worker (or Start with Hello World).
2. Name the Worker `dealermate-share` and deploy.
3. Open Edit code. Replace the sample source with the complete contents of `worker.mjs`, then deploy again.
4. Opening the workers.dev root URL should show “딜러메이트 공유 미리보기 준비 완료”.
5. Use that root URL when wiring the frontend share URL. Do not replace the existing viewer host or publish links before deployment verification.

## URLs

- `/r/<token>` or `/r/<vehicle-number>-<32-hex-token>`: metadata and browser navigation to the existing report viewer.
- `/image/<token>`: only the first general vehicle photo; checks the report is still published and unexpired on every request.
- An optional numeric `v` query can distinguish preview revisions when sharing again. Kakao may retain already-generated preview cards; no immediate refresh guarantee is implied.

Only the existing public read RPC is called. A public publishable key is included, matching the public viewer. Never substitute a secret/service-role key. Account details, inspection opinions and finding photos are excluded from preview metadata. The worker does not log tokens or cache report responses; providers may retain cards already sent to chat.

Existing hash links continue working and do not automatically acquire individual previews. Generate/copy the new preview link after the frontend is configured. Report expiry and revocation are enforced by the existing RPC and rechecked in the image route.

## Verification

From the repository root: `node test-cloudflare-preview.mjs` (if the test file is available locally). Mock verification covers metadata escaping, vehicle-only photos, excluded account data, normal navigation, expired/revoked reports, image host restrictions, unsupported methods and upstream failures. After deploying, verify with a live published report before enabling the new link format.
