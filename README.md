# Cosmoner SDK

Official Cosmoner SDKs for JavaScript, Python, and PHP.

| Language   | Package         | Install                         |
| ---------- | --------------- | ------------------------------- |
| JavaScript | `@cosmoner/sdk` | `npm install @cosmoner/sdk`     |
| Python     | `cosmoner-sdk`  | `pip install cosmoner-sdk`      |
| PHP        | `cosmoner/sdk`  | `composer require cosmoner/sdk` |

## Usage

Each SDK provides a `Cosmoner` client with service namespaces. Currently supports `client.email`.

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

## Documentation

See the README in each language directory for full API reference:

- [JavaScript](./javascript/README.md)
- [Python](./python/README.md)
- [PHP](./php/README.md)

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
```

`npm run lint` uses [oxlint](https://oxc.rs/docs/guide/usage/linter); `composer run lint:fix`
and `ruff check --fix` apply the auto-fixable subset.

## License

[MIT](./LICENSE)
