# cosmoner/sdk

Official Cosmoner SDK for PHP.

## Installation

```bash
composer require cosmoner/sdk
```

## Usage

```php
use Cosmoner\Sdk\Cosmoner;

$client = new Cosmoner(
    apiKey: 'your-api-key',
    projectId: 'your-project-id',
);

// Send to a single recipient
$result = $client->email->send(
    credentialId: 'your-credential-id',
    to: 'recipient@example.com',
    subject: 'Hello from Cosmoner',
    html: '<h1>Hello!</h1><p>This is a test email.</p>',
);

echo $result['data']['messageId'];

// Send to multiple recipients (up to 50)
$client->email->send(
    credentialId: 'your-credential-id',
    to: ['alice@example.com', 'bob@example.com'],
    subject: 'Team Update',
    text: 'Plain text email body',
    replyTo: 'noreply@yourdomain.com',
);
```

## Configuration

| Parameter    | Required | Default                    | Description                                        |
| ------------ | -------- | -------------------------- | -------------------------------------------------- |
| `apiKey`     | Yes      | —                          | Your Cosmoner API key                              |
| `projectId`  | No       | —                          | Default project; can also be passed per call       |
| `baseUrl`    | No       | `https://api.cosmoner.com` | API base URL override                              |
| `timeout`    | No       | `30.0`                     | Per-request timeout in seconds                     |
| `maxRetries` | No       | `2`                        | Retries for transient failures (see [Retries](#retries)) |
| `httpClient` | No       | `CurlHttpClient`           | Custom `HttpClient` implementation                 |

`projectId` is optional so one client can span projects. Pass it per call to
override the default:

```php
$client = new Cosmoner(apiKey: 'your-api-key');

$client->email->send(
    credentialId: '...',
    to: '...',
    subject: '...',
    text: '...',
    projectId: 'proj-2',
);
```

## Retries

Transient failures are retried automatically with exponential backoff and full
jitter, honouring `Retry-After` when the API sends it.

- **429** is always retried — the request was rejected before it was processed,
  so replaying it cannot duplicate a side effect.
- **Timeouts and 5xx** are retried only for idempotent methods. A write such as
  `email->send()` is *not* replayed, because the API may have completed the send
  before failing to answer.

Set `maxRetries: 0` to disable retries entirely.

## Custom HTTP client

Requests go through the `HttpClient` interface, backed by ext-curl by default.
Supply your own to plug in a PSR-18 client, add logging, or stub HTTP in tests:

```php
use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\HttpClient;
use Cosmoner\Sdk\HttpResponse;

final class MyHttpClient implements HttpClient
{
    public function send(string $method, string $url, array $headers, ?string $body, float $timeout): HttpResponse
    {
        // ...
    }
}

$client = new Cosmoner(apiKey: 'your-api-key', httpClient: new MyHttpClient());
```

## Email

### `$client->email->send(...)`

| Parameter      | Type                     | Required | Description                          |
| -------------- | ------------------------ | -------- | ------------------------------------ |
| `credentialId` | `string`                 | Yes      | SMTP credential ID                   |
| `to`           | `string \| string[]`     | Yes      | Recipient(s), max 50                 |
| `subject`      | `string`                 | Yes      | Email subject line                   |
| `html`         | `string \| null`         | No*      | HTML body                            |
| `text`         | `string \| null`         | No*      | Plain text body                      |
| `replyTo`      | `string \| string[]`     | No       | Reply-to address(es), max 5          |
| `projectId`    | `string \| null`         | No       | Overrides the client-level project   |

\* At least one of `html` or `text` must be provided.

## Apps

Rolls an image app onto a new image and waits for the result — the step a CI
job runs after pushing to a Cosmoner registry.

```php
$apps = $client->apps->list()['data'];

$deployment = $client->apps->deploy('app-id', tag: 'v2')['data'];

$final = $client->apps->waitForDeployment(
    'app-id',
    $deployment['id'],
    onPoll: fn (array $d) => print("{$d['phase']}\n"),
);

if ($final['phase'] !== 'ACTIVE') {
    exit(1);
}
```

`waitForDeployment()` returns for every finished phase (`ACTIVE`, `ERROR`,
`CANCELED`, `SUPERSEDED`), so check `phase`. It throws only when a request fails
or the timeout passes, and the deployment keeps going server-side either way.

### `$client->apps->deploy(...)`

| Parameter   | Type             | Required | Description                                        |
| ----------- | ---------------- | -------- | -------------------------------------------------- |
| `appId`     | `string`         | Yes      | The image app to deploy                            |
| `tag`       | `string \| null` | No*      | Tag to deploy from the repository the app pulls from |
| `digest`    | `string \| null` | No*      | `sha256:` followed by 64 hex characters            |
| `projectId` | `string \| null` | No       | Overrides the client-level project                 |

\* Pass `tag` or `digest`, not both. Pass neither to re-resolve the image the
app already names.

### `$client->apps->waitForDeployment(...)`

| Parameter      | Type                | Required | Description                                  |
| -------------- | ------------------- | -------- | -------------------------------------------- |
| `appId`        | `string`            | Yes      | The app the deployment belongs to            |
| `deploymentId` | `string`            | Yes      | `id` returned by `deploy()`                  |
| `interval`     | `float`             | No       | Seconds between polls. Defaults to `3.0`     |
| `timeout`      | `float`             | No       | Seconds to wait in total. Defaults to `600.0` |
| `onPoll`       | `callable \| null`  | No       | Called with every poll result, including the last |
| `projectId`    | `string \| null`    | No       | Overrides the client-level project           |

`$client->apps->getDeployment($appId, $deploymentId)` fetches a single poll's
worth of state.

## Hosting

Reads a project's shared hosting sites and where to reach their files. Needs an
API key with `hosting:read`.

```php
$sites = $client->hosting->list()['data'];
$access = $client->hosting->access($sites[0]['id'])['data'];
// $access['username'], $access['host'], $access['sftp']['port'], $access['ssh']
```

`$client->hosting->get($siteId, credentials: true)` also returns the site's
`sftpPassword`. It needs no scope beyond `hosting:read`, so guard the key
accordingly.

## Secrets

Stores the values a deployment file refers to with `from_secret`. Needs an API
key with `secrets:read`, and `secrets:write` to change anything.

```php
$secret = $client->secrets->create('DB_PASSWORD', 'hunter2', environment: 'production')['data'];
$secret['value'];        // 'hunter2' — returned here and nowhere else
$secret['maskedValue'];  // 'hu••••r2', safe to display

$secrets = $client->secrets->list('production')['data'];
// name, environment, version, who changed it and when — never the value
```

A secret's value is encrypted at rest and returned exactly once, by the call
that sets it. `list()` and `get()` describe a secret without its value, and no
route decrypts one, so a lost value is replaced rather than recovered.

`update($id, $value)` replaces a value and bumps `version`; `delete($id)`
removes it; `usage()` reports how many secrets the project holds and may hold;
`audit($id)` reads who changed it and when.

Two API behaviours are worth knowing before you debug them:

- **Writes need an owner or admin.** The API checks the member's role
  independently of the key's scopes, so a plain member's key is refused with a
  403 even when it carries `secrets:write`.
- **Creating is rate-limited** to 10 requests per 10 minutes, and a project at
  its secret limit answers 402.

## Variables

The plaintext sibling of secrets, for non-sensitive configuration a deployment
file refers to with `from_variable`. Needs `variables:read`, and
`variables:write` to change anything.

```php
$client->variables->create('LOG_LEVEL', 'debug');
$client->variables->list()['data'][0]['value']; // 'debug' — returned on every read
```

That is the difference between the two resources, not an oversight: anything
worth hiding belongs in `$client->secrets`. `update()` here takes a value, a
description, or both.

## Deployment files

Validates a `.cosmoner/deployment.yaml` — the file you commit to describe how a
repository deploys — without an API key or a network call.

```php
use Cosmoner\Sdk\Deployment;

$result = Deployment::validate(file_get_contents('.cosmoner/deployment.yaml'));

foreach ($result->issues as $issue) {
    echo "{$issue->severity} {$issue->path}: {$issue->message}\n";
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

### `Deployment::validate(string $source, bool $strict = false)`

| Parameter | Type | |
| --- | --- | --- |
| `$source` | `string` | The file as written — raw text, not a parsed value. |
| `$strict` | `bool` | Treat warnings as errors. Defaults to `false`. |

Returns a `DeploymentValidationResult` with `$valid`, `$issues`, `$template`,
and `errors()` / `warnings()` for the two halves of `$issues`.
`Deployment::validateDocument()` is the same check over an already-parsed value.

`Deployment::FILE_PATHS` lists the locations the platform checks, in the order
it checks them, and `Deployment::APP_SCHEMA_URL` is the published JSON Schema an
editor can be pointed at.

## Error Handling

Every failure throws a subclass of `CosmonerError`, so you can catch broadly or
narrowly:

```php
use Cosmoner\Sdk\CosmonerError;
use Cosmoner\Sdk\RateLimitError;

try {
    $client->email->send(...);
} catch (RateLimitError $e) {
    echo $e->retryAfter;   // seconds, when the API supplies it
} catch (CosmonerError $e) {
    echo $e->errorCode;    // e.g. "INSUFFICIENT_SCOPE"
    echo $e->status;       // e.g. 403
    print_r($e->details);  // field-level validation errors, when present
    echo $e->getMessage(); // Human-readable message
}
```

| Exception                 | Thrown on                                     |
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
