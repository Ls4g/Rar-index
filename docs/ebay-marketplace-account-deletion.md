# eBay marketplace account-deletion setup

RAR's production endpoint is:

`https://rar-index.vercel.app/api/ebay/account-deletion`

## Before entering anything in eBay

In Vercel, add this **Production** environment variable to the `rar-index` project:

| Name | Value |
| --- | --- |
| `EBAY_DELETION_VERIFICATION_TOKEN` | A unique 32–80 character secret using letters, numbers, `_`, or `-` only. |

Redeploy after saving the variables. Never commit or paste the verification token into GitHub, source code, or chat.

## eBay page

Keep **Marketplace Account Deletion** selected, then enter:

- Alert email: an address monitored by the RAR owner.
- Marketplace account deletion notification endpoint: `https://rar-index.vercel.app/api/ebay/account-deletion`
- Verification token: exactly the same secret stored in Vercel.

When Save is pressed, eBay sends a `GET` challenge to the RAR endpoint. RAR returns the required SHA-256 challenge response. Once eBay accepts it, use **Send Test Notification**.

## Current data boundary

RAR currently retains listing-level market evidence only and does not store eBay sign-in tokens, user IDs, or customer account data. The endpoint acknowledges deletion notices without persisting their payload. If RAR later adds eBay sign-in or stores eBay user data, upgrade this endpoint to validate the eBay signature and delete matching data before acknowledgement.
