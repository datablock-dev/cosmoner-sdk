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

### Sending domains

| Method | Description |
| --- | --- |
| `list_domains(*, project_id=None)` | Every sending domain with its SMTP credentials and DNS records |
| `get_domain(email_domain_id, *, project_id=None)` | One sending domain; adds `sending` (`identity`, `billingRequired`) |
| `delete_domain(email_domain_id, *, project_id=None)` | Permanently removes a sending domain; the API answers 204, so it returns `None` |
| `create_credential(email_domain_id, *, label, from_address, project_id=None)` | Issues an SMTP credential; `from_address` must be on the domain. Returns `smtpPassword` once |
| `delete_credential(email_domain_id, credential_id, *, project_id=None)` | Revokes an SMTP credential, so anything sending with it stops working; returns `None` |

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
| `get(app_id, *, project_id=None)` | One app by id |
| `update(app_id, *, name=…, build_command=…, run_command=…, output_dir=…, public_port=…, internal_port=…, auto_deploy=…, image_deploy_policy=…, instances=…, project_id=None)` | Changes the settings given and returns the app |
| `delete(app_id, *, project_id=None)` | Permanently deletes an app |
| `logs(app_id, *, type, project_id=None)` | Recent log lines; `type` is `"BUILD"` or `"RUN"`, anything else raises `ValueError` |
| `deploy(app_id, *, tag=None, digest=None, project_id=None)` | Starts a deployment and returns it without waiting |
| `get_deployment(app_id, deployment_id, *, project_id=None)` | One deployment's current phase |
| `wait_for_deployment(app_id, deployment_id, *, interval=3.0, timeout=600.0, on_poll=None, project_id=None)` | Polls until the deployment finishes |
| `preview(*, size, project_id=None)` | Prices an app of `size` without creating it |
| `create_draft(*, size, region, name=None, app_type=None, git_provider=None, …, project_id=None)` | Saves the settings as a free draft and returns its `draftId` |
| `create(*, draft_id, size, project_id=None)` | Creates the app from a draft and charges for it; returns `appId` |
| `sizes(app_id, *, project_id=None)` | `currentSize`, whether it is `resizable`, and the `sizes` it can move to |
| `resize_preview(app_id, *, size, project_id=None)` | Prices a resize; adds `direction`, `creditBack` and `currentMonthly` |
| `resize(app_id, *, size, project_id=None)` | Moves the app to `size`, charging the difference immediately |

A draft costs nothing and expires after 24 hours. `create_draft` takes the
app's settings as snake_case arguments — `git_repo`, `git_branch`,
`source_dir`, `build_strategy`, `build_command`, `run_command`, `output_dir`,
`public_port`, `internal_port`, `auto_deploy`, `container_registry`,
`container_image`, `container_public_port`, `image_deploy_policy`, `instances`
— and sends only those given, under their camelCase API names.

`update` sends only the arguments you pass, under their camelCase API names, and
raises `ValueError` when you pass none. `image_deploy_policy` is `"TAG"`,
`"NEWEST"` or `"MANUAL"`. Pass `None` to `build_command`, `run_command`,
`output_dir`, `public_port` or `internal_port` to clear it.

Pass `tag` or `digest` (`sha256:` plus 64 hex characters) to deploy that image
from the repository the app already pulls from, or neither to re-resolve the
image the app names now. Passing both raises `ValueError`.

`wait_for_deployment` returns the deployment in whichever phase it finished —
`ACTIVE`, `ERROR`, `CANCELED` or `SUPERSEDED` — so check `phase` yourself. It
raises only when a request fails, or `TimeoutError` once `timeout` seconds pass,
in which case the deployment keeps going server-side. `interval` and `timeout`
are in seconds.

## Hosting

Reads a project's shared hosting sites and where to reach their files. Needs an
API key with `hosting:read`.

| Method | Description |
| --- | --- |
| `list(*, project_id=None)` | Every site in the project that has not been deprovisioned |
| `get(site_id, *, credentials=False, project_id=None)` | One site; `credentials=True` adds `sftpPassword` |
| `access(site_id, *, project_id=None)` | `username`, `host`, `sftp.port` and `ssh.port`/`ssh.enabled` |
| `delete(site_id, *, project_id=None)` | Permanently deletes a site |
| `prices(*, project_id=None)` | Each tier's `monthly` price in minor units, with its `currency` |
| `preview(*, tier, extra_storage_gb=0, project_id=None)` | Prices a site without creating it |
| `create(*, site_name, tier=None, php_version=None, database=None, extra_storage_gb=None, project_id=None)` | Creates a site and charges for it; `database` names a database to create with it |

The password needs no scope beyond `hosting:read`, so guard the key accordingly.

## Other namespaces

Each of these manages one kind of resource and returns the API envelope, or
`None` where the API answers 204. Every method takes `project_id=` to override
the client default, except `projects` and `catalog`, which read across the
account and never use the default project. A method taking an id raises `ValueError` on an empty
one before sending anything. Every `delete` is permanent.

| Namespace | Methods |
| --- | --- |
| `projects` | `list()`, `get(project)` — by id or slug |
| `catalog` | `server_sizes()`, `server_regions()`, `server_images()`, `redis_plans()`, `redis_regions()`, `databases()`, `app_sizes()`, `app_regions()` — what can be created; account-wide, so never uses the default project |
| `servers` | `list()`, `get(server_id)` — adds the installed `sshKeys`; `preview(*, size, provider=None)`, `create(*, name, size, region, image=None, ssh_key_ids=None, provider=None)`, `delete(server_id)` |
| `ssh_keys` | `list()`, `create(*, name, public_key)`, `generate(*, name)` — returns `privateKey` once; `delete(ssh_key_id)` — see below |
| `databases` | `list()` (every kind), `list_dedicated()`, `get_dedicated(database_id)`, `preview_dedicated(*, size)`, `create_dedicated(*, name, size, version, region, engine=None)`, `delete_dedicated(database_id)`, `list_shared()`, `get_shared(tenant_id)`, `delete_shared(tenant_id)` |
| `redis` | `list()`, `get(redis_id)`, `preview(*, plan)`, `create(*, name, plan, region, persistence=None)`, `delete(redis_id)` |
| `domains` | `list()`, `get(domain)`, `create(name)`, `verify(domain)`, `delete(domain)` — by id or name, such as `example.com` |
| `buckets` | `list()` — there is no single-bucket read; `preview(*, tier=None)`, `create(*, name, region, tier=None, public_access=None, versioning=None, cdn_enabled=None)`, `delete(bucket_id)` also deletes every object in it and its access credentials |
| `registries` | `list()`, `get(registry_id)`, `preview()`, `providers()`, `create(*, name, region, provider=None)`, `delete(registry_id)` — also deletes every repository and image in it |
| `iam` | `list()`, `get(iam_user_name)` — the list holds `credentials` plus partial-failure `errors`; `create(*, label, storage_access=None, bucket_ids=None, registry_access=None, repository_ids=None)` — returns `secretAccessKey` once; `delete(iam_user_name)` returns `None` |
| `members` | `list()` — members and pending invitations |

Two of these return a credential, and each needs only the namespace's read
scope, so guard keys that carry it: `databases.get_dedicated` always includes
`connectionUri`, a full connection URI with the password, and `redis.get`
always includes the plaintext `password`.

### Credentials returned once

`iam.create`, `email.create_credential` and `ssh_keys.generate` each return a
credential exactly once — `secretAccessKey`, `smtpPassword` and `privateKey`.
The API keeps only a hash or nothing at all, so no later read returns it: store
it from that response.

```python
key = client.iam.create(label="CI", storage_access="read", bucket_ids=["bkt-1"])
key["data"]["secretAccessKey"]  # store it now; it cannot be read again
```

`iam.create` needs at least one of `storage_access` (`"read"` or `"write"`) and
`registry_access` (`"pull"` or `"push"`), and `label` is 1–20 characters.
Omitting `bucket_ids` or `repository_ids`, or passing an empty list, grants
every bucket or repository, including ones created later. Passing ids without
their access raises `ValueError`. `ssh_keys.generate` returns an RSA 4096 key in
PKCS#1 PEM (`-----BEGIN RSA PRIVATE KEY-----`) and registers its public half.

`domains.create` adds a domain you already own; buying one is not available
through the SDK. Its response carries `verificationRecord`, the TXT record to
publish before calling `domains.verify`. `domains.delete` answers 409 while an
app or email domain still uses the domain.

### Paid creates

Every `create` above, and `apps.resize`, **charges the project's saved card
immediately** with a prorated invoice. A project that cannot be billed is
refused with a 402 (`ORG_PAYMENT_METHOD_REQUIRED`,
`BILLER_PAYMENT_METHOD_REQUIRED` or `PAYMENT_REQUIRED`) before anything is
created. Price it first with the matching `preview`:

```python
sizes = client.catalog.server_sizes()["data"]
price = client.servers.preview(size="s-1vcpu-1gb")["data"]
print(price["monthly"], price["currency"])  # 600 USD — minor units, before tax

client.servers.create(name="web", size="s-1vcpu-1gb", region="fra1")
```

A preview returns `subtotal`, `tax`, `creditApplied`, `dueToday`, `monthly`,
`currency` and `nextBillingDate`, every amount an integer in minor units.
`monthly` is exact and excludes tax; `dueToday` is an estimate for a project
that already has a subscription, because the real charge is prorated onto it.
The bucket preview prices the tier fee only, since CDN traffic is metered, and
the registry preview the base fee only, since storage and egress are metered.

Server, Redis, dedicated database and bucket creates return `{"deployed": True}`
with no id — list the namespace and match by name. Servers start
`PROVISIONING`, Redis and databases `CREATING`. A registry create returns its
`id`, and an app create its `appId`.

`ssh_keys.delete` removes the key from the project, not from servers it was
already installed on: `stillAuthorisedOn` in the response counts them.

## Secrets

Stores the values a deployment file refers to with `from_secret`. Needs an API
key with `secrets:read`, and `secrets:write` to change anything.

```python
secret = client.secrets.create("DB_PASSWORD", "hunter2", environment="production")
secret["data"]["value"]        # "hunter2" — returned here and nowhere else
secret["data"]["maskedValue"]  # "hu••••r2", safe to display

listed = client.secrets.list(environment="production")
# name, environment, version, who changed it and when — never the value
```

| Method | Description |
| --- | --- |
| `list(*, environment=None, project_id=None)` | Metadata for every secret, or for one environment |
| `get(secret_id, *, project_id=None)` | One secret's metadata, without its value |
| `create(name, value, *, description=None, environment=None, project_id=None)` | Stores a secret; returns the plaintext once |
| `update(secret_id, value, *, description=None, project_id=None)` | Replaces the value and bumps `version` |
| `delete(secret_id, *, project_id=None)` | Removes it |
| `usage(*, project_id=None)` | How many secrets the project holds and may hold |
| `audit(secret_id, *, project_id=None)` | Who changed it and when, never to what |

A secret's value is encrypted at rest and returned exactly once, by the call
that sets it. No route decrypts one, so a lost value is replaced rather than
recovered.

Two API behaviours are worth knowing before you debug them:

- **Writes need an owner or admin.** The API checks the member's role
  independently of the key's scopes, so a plain member's key is refused with a
  403 even when it carries `secrets:write`.
- **Creating is rate-limited** to 100 per project every 10 minutes, shared by
  every key and machine working on the project, and a project at its secret
  limit answers 402.

## Variables

The plaintext sibling of secrets, for non-sensitive configuration a deployment
file refers to with `from_variable`. Needs `variables:read`, and
`variables:write` to change anything.

```python
client.variables.create("LOG_LEVEL", "debug")
client.variables.list()["data"][0]["value"]  # "debug" — returned on every read
```

| Method | Description |
| --- | --- |
| `list(*, environment=None, project_id=None)` | Every variable, values included |
| `get(variable_id, *, project_id=None)` | One variable, value included |
| `create(name, value, *, description=None, environment=None, project_id=None)` | Stores a variable |
| `update(variable_id, *, value=None, description=None, project_id=None)` | Changes the value, the description, or both |
| `delete(variable_id, *, project_id=None)` | Removes it |

That values are returned in full is the difference between the two resources,
not an oversight: anything worth hiding belongs in `client.secrets`.

`AsyncCosmoner` exposes the same two namespaces, with `await`.

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
    print(e.docs_url) # page explaining the fix, when the API links one
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
