Run `npm run test:receipt` from the API repository. Tests replace the database module and email transport before loading the routes; they do not access live customer records or send email.

Receipt behavior:
- Only finished sales can send receipts, with explicit invoice confirmation.
- New UI requests also confirm the recipient address. Older UI requests remain compatible.
- Customer email corrections from Daily Sales use the existing staff approval process.
- A stored receipt timestamp makes subsequent requests return the current sent state without contacting the provider.
- Concurrent requests use the same provider idempotency key and only the first timestamp is persisted.
- Missing email, configuration errors, and rejected provider requests leave the timestamp empty.
- Provider acceptance means accepted for delivery, not verified arrival in the customer's inbox.

Operational limitation: email acceptance and database persistence are separate operations. Timeouts and failures saving the sent status require an administrator to check Resend before another send. Resend retains idempotency keys for 24 hours (https://resend.com/docs/dashboard/emails/idempotency-keys); changing the payload under the same key can also produce a conflict. Do not bypass that conflict with a new key. This change does not add a durable outbox or delivery webhooks, and does not guarantee exactly-once delivery after an ambiguous failure.
