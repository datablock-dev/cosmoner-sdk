# cosmoner-sdk

Official Cosmoner SDK for Python.

## Installation

```bash
pip install cosmoner-sdk
```

## Usage

```python
from cosmoner import Cosmoner

client = Cosmoner(
    api_key="your-api-key",
    project_id="your-project-id",
)

# Send to a single recipient
result = client.email.send(
    credential_id="your-credential-id",
    to="recipient@example.com",
    subject="Hello from Cosmoner",
    html="<h1>Hello!</h1><p>This is a test email.</p>",
)
print(result["data"]["messageId"])

# Send to multiple recipients (up to 50)
client.email.send(
    credential_id="your-credential-id",
    to=["alice@example.com", "bob@example.com"],
    subject="Team Update",
    text="Plain text email body",
    reply_to="noreply@yourdomain.com",
)
```

## Configuration

| Parameter     | Required | Default                    | Description                                        |
| ------------- | -------- | -------------------------- | -------------------------------------------------- |
| `api_key`     | Yes      | —                          | Your Cosmoner API key                              |
| `project_id`  | No       | —                          | Default project; can also be passed per call       |
| `base_url`    | No       | `https://api.cosmoner.com` | API base URL override                              |
| `timeout`     | No       | `30.0`                     | Per-request timeout in seconds                     |
| `max_retries` | No       | `2`                        | Retries for transient failures (see [Retries](#retries)) |

`project_id` is optional so one client can span projects. Pass it per call to
override the default:

```python
client = Cosmoner(api_key="your-api-key")

client.email.send(project_id="proj-2", credential_id="...", to="...", subject="...", text="...")
```

## Async

`AsyncCosmoner` mirrors the sync client method for method:

```python
from cosmoner import AsyncCosmoner

async with AsyncCosmoner(api_key="your-api-key", project_id="your-project-id") as client:
    await client.email.send(
        credential_id="your-credential-id",
        to="recipient@example.com",
        subject="Hello",
        text="Hi there",
    )
```

Both clients hold a connection pool. Use them as context managers, or call
`client.close()` / `await client.aclose()` when you are done.

## Retries

Transient failures are retried automatically with exponential backoff and full
jitter, honouring `Retry-After` when the API sends it.

- **429** is always retried — the request was rejected before it was processed,
  so replaying it cannot duplicate a side effect.
- **Timeouts and 5xx** are retried only for idempotent methods. A write such as
  `email.send` is *not* replayed, because the API may have completed the send
  before failing to answer.

Set `max_retries=0` to disable retries entirely.

## Email

### `client.email.send(...)`

| Parameter       | Type                     | Required | Description                          |
| --------------- | ------------------------ | -------- | ------------------------------------ |
| `credential_id` | `str`                    | Yes      | SMTP credential ID                   |
| `to`            | `str \| list[str]`       | Yes      | Recipient(s), max 50                 |
| `subject`       | `str`                    | Yes      | Email subject line                   |
| `html`          | `str`                    | No*      | HTML body                            |
| `text`          | `str`                    | No*      | Plain text body                      |
| `reply_to`      | `str \| list[str]`       | No       | Reply-to address(es), max 5          |
| `project_id`    | `str`                    | No       | Overrides the client-level project   |

\* At least one of `html` or `text` must be provided.

## Apps

Rolls an image app onto a new image and waits for the result. Only image apps
pulling from a Cosmoner registry can be deployed this way.

```python
started = client.apps.deploy("app-id", tag="1.4.0")

deployment = client.apps.wait_for_deployment(
    "app-id",
    started["data"]["id"],
    on_poll=lambda d: print(d["phase"]),
)
if deployment["phase"] != "ACTIVE":
    raise SystemExit(deployment["error"])
```

| Method | Description |
| --- | --- |
| `list(*, project_id=None)` | Every app in the project, newest first |
| `deploy(app_id, *, tag=None, digest=None, project_id=None)` | Starts a deployment and returns it without waiting |
| `get_deployment(app_id, deployment_id, *, project_id=None)` | One deployment's current phase |
| `wait_for_deployment(app_id, deployment_id, *, interval=3.0, timeout=600.0, on_poll=None, project_id=None)` | Polls until the deployment finishes |

Pass `tag` or `digest` (`sha256:` plus 64 hex characters) to deploy that image
from the repository the app already pulls from, or neither to re-resolve the
image the app names now. Passing both raises `ValueError`.

`wait_for_deployment` returns the deployment in whichever phase it finished —
`ACTIVE`, `ERROR`, `CANCELED` or `SUPERSEDED` — so check `phase` yourself. It
raises only when a request fails, or `TimeoutError` once `timeout` seconds pass,
in which case the deployment keeps going server-side. `interval` and `timeout`
are in seconds.

## Deployment files

Validates a `.cosmoner/deployment.yaml` — the file you commit to describe how a
repository deploys — without an API key or a network call.

```python
from pathlib import Path

from cosmoner import validate_deployment

result = validate_deployment(Path(".cosmoner/deployment.yaml").read_text())

for issue in result.issues:
    print(f"{issue.severity} {issue.path}: {issue.message}")
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

### `validate_deployment(source, *, strict=False)`

| Parameter | Type | |
| --- | --- | --- |
| `source` | `str` | The file as written — raw text, not a parsed object. |
| `strict` | `bool` | Treat warnings as errors. Defaults to `False`. |

Returns a `DeploymentValidationResult` with `valid`, `issues`, `template`, and
`errors` / `warnings` for the two halves of `issues`.
`validate_deployment_document(document, *, strict=False)` is the same check over
an already-parsed object.

`DEPLOYMENT_FILE_PATHS` lists the locations the platform checks, in the order it
checks them, and `APP_SCHEMA_URL` is the published JSON Schema an editor can be
pointed at.

Note that these files are read as YAML 1.2, which is what the platform does:
`autodeploy: yes` is the string `"yes"`, not a boolean. PyYAML's own default
would disagree, so this SDK narrows its loader to match.

## Error Handling

Every failure raises a subclass of `CosmonerError`, so you can catch broadly or
narrowly:

```python
from cosmoner import Cosmoner, CosmonerError, RateLimitError

try:
    client.email.send(...)
except RateLimitError as e:
    print(e.retry_after)  # seconds, when the API supplies it
except CosmonerError as e:
    print(e.code)     # e.g. "INSUFFICIENT_SCOPE"
    print(e.status)   # e.g. 403
    print(e.details)  # field-level validation errors, when present
    print(str(e))     # Human-readable message
```

| Exception                  | Raised on                                     |
| -------------------------- | --------------------------------------------- |
| `ValidationError`          | 400, 422                                      |
| `AuthenticationError`      | 401                                           |
| `InsufficientScopeError`   | 403 — API key is missing a `resource:action`  |
| `NotFoundError`            | 404                                           |
| `ConflictError`            | 409                                           |
| `RateLimitError`           | 429                                           |
| `ServerError`              | 5xx                                           |
| `CosmonerTimeoutError`     | Request exceeded `timeout`                    |
| `CosmonerConnectionError`  | DNS, TCP, TLS or socket failure               |
