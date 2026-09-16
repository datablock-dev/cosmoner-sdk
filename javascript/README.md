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

## Apps

```ts
const { data: apps } = await client.apps.list();
const web = apps.find((app) => app.name === "web")!;

const { data: started } = await client.apps.deploy(web.id, { tag: "v2" });
const finished = await client.apps.waitForDeployment(web.id, started.id);

if (finished.phase !== "ACTIVE") throw new Error(finished.error ?? finished.phase);
```

### `client.apps.deploy(appId, params?)`

Starts deploying an image app — one that runs an image from a Cosmoner registry
— and returns the deployment without waiting. Apps built from a repository are
refused. Needs an API key with `apps:write`.

| Parameter   | Type     | Required | Description                                           |
| ----------- | -------- | -------- | ----------------------------------------------------- |
| `tag`       | `string` | No       | Tag to deploy from the app's repository               |
| `digest`    | `string` | No       | Exact image, `sha256:<64 hex characters>`             |
| `projectId` | `string` | No       | Overrides the client-level project                    |

Pass `tag` or `digest`, not both. With neither, the image the app already names
is pulled again.

### `client.apps.waitForDeployment(appId, deploymentId, params?)`

Polls until the deployment finishes and resolves with it in its final phase —
`ACTIVE`, `ERROR`, `CANCELED` or `SUPERSEDED`. It rejects only when a request
fails or `timeout` (default 10 minutes) passes; the deployment carries on either
way. `interval` defaults to 3 seconds, and `onPoll` is called with every result.
Needs `apps:read`.

`client.apps.list()` and `client.apps.getDeployment(appId, deploymentId)` are
the single calls underneath.

## Deployment files

Validates a `.cosmoner/deployment.yaml` — the file you commit to describe how a
repository deploys — without an API key or a network call.

```typescript
import { validateDeployment } from "@cosmoner/sdk";
import { readFileSync } from "node:fs";

const { valid, issues, template } = validateDeployment(
  readFileSync(".cosmoner/deployment.yaml", "utf8")
);

for (const issue of issues) {
  console.log(`${issue.severity} ${issue.path}: ${issue.message}`);
}
```

```
error services.0.run_command: Static sites cannot define a run_command
warning services.0.prot: Unknown field "prot" — it will be ignored
```

Warnings are things the platform tolerates and you probably did not mean. An
unknown key is the main one: the platform drops it rather than rejecting the
file, so a template written for a newer field still applies its known settings
against an older deploy. Treating that as fatal here would reject files the
platform accepts, so it is reported as a warning that names the consequence.
Pass `strict` when you would rather not let a typo through — it changes the
verdict, not the finding.

`template` is the file as the platform reads it: defaults applied, unknown keys
dropped. Comparing it against what you wrote is the point — it is the settings
that will actually arrive.

The same check is available on the command line, for CI or a pre-commit hook,
without installing anything:

```bash
npx @cosmoner/cli validate --strict
```

### `validateDeployment(source, options?)`

| Parameter | Type | |
| --- | --- | --- |
| `source` | `string` | The file as written — raw text, not a parsed object. |
| `options.strict` | `boolean` | Treat warnings as errors. Defaults to `false`. |

Returns `{ valid, issues, template }`. `validateDeploymentDocument(document,
options?)` is the same check over an already-parsed object, for a file that was
generated rather than read from disk.

`DEPLOYMENT_FILE_PATHS` lists the locations the platform checks, in the order it
checks them, and `APP_SCHEMA_URL` is the published JSON Schema an editor can be
pointed at.

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
