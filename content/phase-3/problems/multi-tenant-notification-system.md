## Scenario

Your SaaS platform sends notifications everywhere: "Invoice #4021 was approved", "Your purchase order needs review", "Payment failed", "Weekly summary", "Password reset". Today each feature calls the email provider directly from its request handler. Customers complain that some emails never arrive, some arrive twice, the weekly summary takes the app down every Monday, and enterprise tenants are asking for in-app notifications, Slack integration, per-user preferences and quiet hours.

Design a **multi-tenant notification system** that any feature in the product can use with one call. This is a pure design problem: you produce a design document and an architecture diagram.

## Scale numbers (use these, state extra assumptions)

- 5,000 tenants, 250,000 users, 60,000 daily active.
- Transactional notifications (approvals, mentions, payment failures): about 1.5 million/day, triggered by user actions, spiky during business hours.
- Digest notifications (weekly summary): 250,000 generated every Monday at 07:00 in each tenant's local timezone.
- Channels: email (all), in-app (all), Slack/Teams webhooks (about 10% of tenants), SMS for security alerts only (about 20,000/day).
- Largest tenant: 30,000 users. A single "announce to all users" action from that tenant produces 30,000 notifications at once.
- External limits: the email provider allows 500 sends/second for your account; Slack webhooks rate limit at about 1 message/second per webhook.
- Targets: security notifications (password reset, 2FA) delivered to the provider within 5 seconds p99; transactional within 60 seconds p95; digests within 2 hours of the scheduled time; in-app notifications visible within 2 seconds.

## What to produce

### 1. Diagram

Draw the architecture on the whiteboard and export it.

### 2. DESIGN.md

1. **Requirements:** functional, non-functional, out of scope.
2. **Estimations with working shown:** average and peak notifications per second per channel, the Monday digest burst, the 30,000-user announcement, storage for notification history (decide a retention), and whether 500 emails/second is enough at peak.
3. **High-level design:** the internal API (for example `notify({ tenantId, recipients, type, data, idempotencyKey })`), the data model (notifications, deliveries per channel, user preferences, templates), and each component's purpose.
4. **Deep dives (at least three):**
   - Priority isolation: why a Monday digest flood cannot delay a password reset.
   - Fan-out: how one event becomes N recipients x M channels without one huge job.
   - Tenant fairness and noisy neighbors: per-tenant rate limits and queue design.
   - Respecting external rate limits: token buckets per provider and per webhook, backoff on 429.
   - Exactly-once appearance: idempotency keys end to end so a retried job never sends a duplicate email.
   - Preferences, unsubscribe and quiet hours: where these are evaluated and how they are cached.
   - In-app delivery: storage, unread counts, real-time push across horizontally scaled API instances.
   - Provider failover: what happens when the email provider is down for an hour.
5. **Trade-offs and failure modes** table (at least five rows).
6. **At 10x scale.**

## Constraints

- Features must never call email/SMS/Slack providers directly; they call the notification service.
- One tenant's traffic must not push another tenant's transactional notifications past their target.
- Every delivery attempt must be traceable: who, which channel, which attempt, provider response.
- Respect legal requirements: unsubscribe for marketing-like digests, never for security notifications.

## How to verify

- Your estimate answers with arithmetic: can 500 emails/second absorb the Monday digest plus normal transactional traffic within 2 hours? If not, what does the design do?
- Trace a password reset through the diagram during the Monday digest peak and show the path it takes avoids the digest backlog.
- Trace the 30,000-user announcement and show how it is chunked and rate limited.
- For each failure mode, state what the end user and the tenant admin observe.
- A reviewer can find, for every component on the diagram, the requirement or number that justifies it.
