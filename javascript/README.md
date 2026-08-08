# @cosmoner/sdk

Official Cosmoner SDK for Node.js.

## Installation

```bash
npm install @cosmoner/sdk
```

## Usage

```typescript
import { Cosmoner } from "@cosmoner/sdk";

const client = new Cosmoner({
  apiKey: "your-api-key",
  projectId: "your-project-id",
});

// Send to a single recipient
const result = await client.email.send({
  credentialId: "your-credential-id",
  to: "recipient@example.com",
  subject: "Hello from Cosmoner",
  html: "<h1>Hello!</h1><p>This is a test email.</p>",
});

console.log(result.data.messageId);

// Send to multiple recipients (up to 50)
await client.email.send({
  credentialId: "your-credential-id",
  to: ["alice@example.com", "bob@example.com"],
  subject: "Team Update",
  text: "Plain text email body",
  replyTo: "noreply@yourdomain.com",
});
```

## Configuration

| Option       | Required | Default                    | Description                                        |
| ------------ | -------- | -------------------------- | -------------------------------------------------- |
| `apiKey`     | Yes      | —                          | Your Cosmoner API key                              |
| `projectId`  | No       | —                          | Default project; can also be passed per call       |
| `baseUrl`    | No       | `https://api.cosmoner.com` | API base URL override                              |
| `timeout`    | No       | `30000`                    | Per-request timeout in milliseconds                |
| `maxRetries` | No       | `2`                        | Retries for transient failures (see [Retries](#retries)) |

`projectId` is optional so one client can span projects. Pass it per call to
override the default:

```typescript
const client = new Cosmoner({ apiKey: "your-api-key" });

await client.email.send({ projectId: "proj-2", credentialId: "...", to: "...", subject: "...", text: "..." });
```

## Retries

Transient failures are retried automatically with exponential backoff and full
jitter, honouring `Retry-After` when the API sends it.

- **429** is always retried — the request was rejected before it was processed,
  so replaying it cannot duplicate a side effect.
- **Timeouts and 5xx** are retried only for idempotent methods. A write such as
  `email.send` is *not* replayed, because the API may have completed the send
  before failing to answer.

Set `maxRetries: 0` to disable retries entirely.

## Email

### `client.email.send(params)`

| Parameter      | Type                 | Required | Description                          |
| -------------- | -------------------- | -------- | ------------------------------------ |
| `credentialId` | `string`             | Yes      | SMTP credential ID                   |
| `to`           | `string \| string[]` | Yes      | Recipient(s), max 50                 |
| `subject`      | `string`             | Yes      | Email subject line                   |
| `html`         | `string`             | No*      | HTML body                            |
| `text`         | `string`             | No*      | Plain text body                      |
| `replyTo`      | `string \| string[]` | No       | Reply-to address(es), max 5          |
| `projectId`    | `string`             | No       | Overrides the client-level project   |

\* At least one of `html` or `text` must be provided.

## Error Handling

Every failure throws a subclass of `CosmonerError`, so you can catch broadly or
narrowly:

```typescript
import { Cosmoner, CosmonerError, RateLimitError } from "@cosmoner/sdk";

try {
  await client.email.send({ ... });
} catch (err) {
  if (err instanceof RateLimitError) {
    console.error(err.retryAfter); // seconds, when the API supplies it
  } else if (err instanceof CosmonerError) {
    console.error(err.code);    // e.g. "INSUFFICIENT_SCOPE"
    console.error(err.status);  // e.g. 403
    console.error(err.details); // field-level validation errors, when present
    console.error(err.message); // Human-readable message
  }
}
```

| Error                     | Thrown on                                     |
| ------------------------- | --------------------------------------------- |
| `ValidationError`         | 400, 422                                      |
| `AuthenticationError`     | 401                                           |
| `InsufficientScopeError`  | 403 — API key is missing a `resource:action`  |
| `NotFoundError`           | 404                                           |
| `ConflictError`           | 409                                           |
| `RateLimitError`          | 429                                           |
| `ServerError`             | 5xx                                           |
| `CosmonerTimeoutError`    | Request exceeded `timeout`                    |
| `CosmonerConnectionError` | DNS, TCP, TLS or socket failure               |
