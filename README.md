# Cosmoner SDK

Official Cosmoner SDKs for JavaScript, Python, and PHP, and the `cosmoner`
command line tool.

| Language   | Package         | Install                         |
| ---------- | --------------- | ------------------------------- |
| JavaScript | `@cosmoner/sdk` | `npm install @cosmoner/sdk`     |
| Python     | `cosmoner-sdk`  | `pip install cosmoner-sdk`      |
| PHP        | `cosmoner/sdk`  | `composer require cosmoner/sdk` |
| CLI        | `@cosmoner/cli` | `npx @cosmoner/cli`             |

## Usage

Each SDK provides a `Cosmoner` client with service namespaces. Currently supports `client.email`, `client.webhooks` and `client.apps`.

All three share the same behaviour: automatic retries with jittered backoff, a
configurable timeout, a typed error hierarchy, and an optional project id that
can be set on the client or passed per call. Python additionally ships an
`AsyncCosmoner` client.

### JavaScript / TypeScript

```typescript
import { Cosmoner } from "@cosmoner/sdk";

const client = new Cosmoner({
  apiKey: "your-api-key",
  projectId: "your-project-id",
});

await client.email.send({
  credentialId: "your-credential-id",
  to: ["alice@example.com", "bob@example.com"],
  subject: "Hello from Cosmoner",
  html: "<h1>Hello!</h1>",
});
```

### Python

```python
from cosmoner import Cosmoner

client = Cosmoner(api_key="your-api-key", project_id="your-project-id")

client.email.send(
    credential_id="your-credential-id",
    to=["alice@example.com", "bob@example.com"],
    subject="Hello from Cosmoner",
    html="<h1>Hello!</h1>",
)
```

### PHP

```php
use Cosmoner\Sdk\Cosmoner;

$client = new Cosmoner(apiKey: 'your-api-key', projectId: 'your-project-id');

$client->email->send(
    credentialId: 'your-credential-id',
    to: ['alice@example.com', 'bob@example.com'],
    subject: 'Hello from Cosmoner',
    html: '<h1>Hello!</h1>',
);
```

## Deployment files

All three SDKs validate a `.cosmoner/deployment.yaml` — the file you commit to
describe how a repository deploys — with no API key and no network call. The
CLI does the same from a terminal or a CI job, and does not care what language
the repository it is checking is written in:

```bash
npx @cosmoner/cli validate --strict
```

```
.cosmoner/deployment.yaml
  2:11  error    Service names must be lowercase letters, numbers, or hyphens, and start with a letter or number  services.0.name
  4:18  error    Static sites cannot define a run_command  services.0.run_command
  5:11  warning  Unknown field "prot" — it will be ignored  services.0.prot

2 errors, 1 warning
```

The four give the same answer to the same file. `conformance/` holds the
fixtures and the exact output all of them are held to, and `schemas/` holds the
platform's published JSON Schema, which each language's tests compare their
field table against. See the README in either directory.

## Deploying image apps

`client.apps.deploy()` rolls an app that runs an image from a Cosmoner registry
onto a tag or digest, and `client.apps.waitForDeployment()` waits for it to go
live. The CLI wraps both for CI:

```bash
COSMONER_API_KEY=... COSMONER_PROJECT_ID=... npx @cosmoner/cli deploy web --tag v2
```

It exits 0 once the app is live and 1 if the rollout fails or times out. See
[`cli/README.md`](./cli/README.md) for every option.

## Documentation

See the README in each language directory for full API reference:

- [JavaScript](./javascript/README.md)
- [Python](./python/README.md)
- [PHP](./php/README.md)
- [CLI](./cli/README.md)

## Development

Every pull request runs lint, type checks and tests for each language directory
it touches. To run the same checks locally:

```bash
# JavaScript
cd javascript && npm ci && npm run lint && npm run typecheck && npm test

# Python
cd python && pip install -e ".[test,lint]" && ruff check . && ruff format --check . && mypy && pytest

# PHP
cd php && composer install && composer run lint && composer run analyse && composer run test

# CLI (the type check reads the SDK's source, so install that first)
cd javascript && npm ci && cd ../cli && npm ci && npm run lint && npm run typecheck && npm test
```

The CLI bundles the JavaScript SDK's source rather than depending on the
published package, so a change under `javascript/` runs the CLI's checks too and
releases a new CLI. [`cli/README.md`](./cli/README.md) explains why.

`npm run lint` uses [oxlint](https://oxc.rs/docs/guide/usage/linter); `composer run lint:fix`
and `ruff check --fix` apply the auto-fixable subset.

## License

[MIT](./LICENSE)
