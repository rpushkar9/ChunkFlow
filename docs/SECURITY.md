# ChunkFlow — Security Notes

An honest accounting of ChunkFlow's trust surface and the mitigations in place. Raised by the
2026-07-06 full-repo review.

## Permissions

| Permission | Why it's needed |
|-----------|-----------------|
| `downloads` | Create/manage downloads |
| `storage` | Persist chunk-count, mode badges, upload history |
| `contextMenus` | "Download with ChunkFlow" right-click entry |
| `offscreen` | Assemble chunks into a `blob:` URL (impossible in the MV3 worker) |
| `host_permissions: http://*/*`, `https://*/*` | Detect links + fetch byte ranges on **any** site |
| content script on `http/https://*/*` | Detect download links + intercept clicks on any site |

## The core trust tradeoff (accepted)

ChunkFlow is a **general** download accelerator, so it must be able to fetch from any host, and
its chunk fetches use `credentials: 'include'` so **authenticated** downloads (Google Drive,
signed CDN links) work. Together these mean: a page can present a download-looking link that,
when the user clicks it, causes ChunkFlow to issue an authenticated cross-origin `HEAD`/`GET`.

This is **inherent** to what the extension does. Narrowing `host_permissions` to a fixed domain
list would break the product; dropping credentials would break authenticated downloads. So the
broad surface is an **accepted** risk, mitigated as below rather than removed.

## Mitigations in place

- **User-initiated only.** Fetches happen on an explicit user action — a link *click*, a
  context-menu choice, or a popup "Start" — never automatically on page load.
- **Trusted-sender gates.** `background.js` rejects runtime messages from untrusted senders
  (`isTrustedSender`); `offscreen.js` only accepts messages whose `sender.url` is `background.js`.
- **URL validation.** Only `http`/`https` URLs are acted on (`Utils.isHttpOrHttpsUrl`).
- **No `eval`, no remote code, no external hosts** in the extension itself.
- **Blob lifecycle.** Assembled `blob:` URLs are revoked once their download completes.

## Open hardening options (need a product decision)

1. **Gate credentials by trust level** — use `credentials: 'include'` only for context-menu /
   popup starts (explicit intent) and omit it for content-script auto-intercept. Trade-off:
   would break authenticated downloads triggered by a normal link click.
2. **Narrow host permissions** — ship with an allowlist / `optional_host_permissions` the user
   grants per site. Trade-off: friction; no longer "works everywhere" out of the box.
3. **Confirm before credentialed cross-origin fetch** to an origin different from the page.

These are deliberately **not** implemented yet because each degrades the core UX; they're
recorded here for a future security-vs-usability decision.
