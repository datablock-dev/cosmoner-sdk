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
