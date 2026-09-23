# Domain Switch

The records that move a domain depend on two independent things. Read both from `get_deployment` for each deployment involved (maintenance and production app). Present records verbatim; never compose them yourself.

## Axis 1 — hosting target (`deploymentTarget`)

Staticbot picks the target from the repository; do not override it.

| Target | Typical app | Certificate validation | Routing record | Live when |
|---|---|---|---|---|
| Cloudflare Workers | SSR / full-stack (TanStack Start, Nuxt SSR) | TXT record(s) for the Cloudflare custom hostname | CNAME of the hostname to the returned target | `recheck_dns_verification` shows `customHostnameStatus` **and** `hostnameStatus` = `active` |
| AWS static (S3 + CloudFront) | SPA / static Vite build | ACM validation CNAME | CNAME (subdomain) or ALIAS/ANAME/flattened CNAME (apex) to the CloudFront distribution | HTTPS on the domain serves the new build; `get_deployment` status completed |

Both validation records can be published days ahead without moving traffic, and they should be. Only the routing record changes during the window. An apex domain on a registrar without ALIAS/ANAME/flattening cannot point at CloudFront. Find that out in phase 1 and offer a `www` redirect or moving DNS hosting well before the window.

A stack's domain is fixed once its deployment is created, and one hostname cannot be attached to two stacks. There is only ever one Staticbot stack on the production domain: maintenance and app are two versions of it ([maintenance-versions.md](maintenance-versions.md)). Confirm the exact hostname (apex or `www`) with the user before creating that stack.

## Axis 2 — where the DNS zone lives (`dns[].action`)

| Action | Who writes records |
|---|---|
| `OFFER_CLOUDFLARE_PUSH` | The agent, via `push_dns_to_cloudflare` with the item's exact `domainId`, after the user authorizes each push. Idempotent; never touches nameservers or mail. |
| `MANUAL_RECORDS_AT_REGISTRAR` | The user, at their DNS provider. Give exact records and wait for confirmation. |
| `OFFER_CLOUDFLARE_CONNECT` | Offer to connect Cloudflare in Staticbot integrations before the window; manual records remain the fallback. |
| `REGISTER_DOMAIN_FIRST` | Stop. |

Never recommend moving nameservers as part of the cutover. With mail records present, nameserver changes are out of the question.

## The builder's existing records

The domain currently points at the builder (Lovable or Base44 custom-domain records, commonly an A record and/or CNAME plus a TXT ownership record). Save them verbatim in the state file before changing anything; restoring them is the pre-write rollback. Leave the builder's ownership TXT record in place until the recovery period ends so the domain can be reattached if needed.

## Checks after each flip

- `dig +short <domain>` (or the user's DNS tool) returns the new routing target from a public resolver.
- `curl -sI https://<domain>` returns a valid response and a certificate for the domain.
- For the app: the served bundle talks to the target Supabase URL (preview evidence wiring check, or open the browser network tab on the real domain).
