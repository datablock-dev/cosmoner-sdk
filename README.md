# Datablock SDK

Official Datablock SDKs for JavaScript, Python, and PHP.

| Language   | Package           | Install                        |
| ---------- | ----------------- | ------------------------------ |
| JavaScript | `@datablock/sdk`  | `npm install @datablock/sdk`   |
| Python     | `datablock-sdk`   | `pip install datablock-sdk`    |
| PHP        | `datablock/sdk`   | `composer require datablock/sdk` |

## Usage

Each SDK provides a `Datablock` client with service namespaces. Currently supports `client.email`.

### JavaScript / TypeScript

```typescript
import { Datablock } from "@datablock/sdk";

const client = new Datablock({
  apiKey: "your-api-key",
  projectId: "your-project-id",
});

await client.email.send({
  credentialId: "your-credential-id",
  to: ["alice@example.com", "bob@example.com"],
  subject: "Hello from Datablock",
  html: "<h1>Hello!</h1>",
});
```

### Python

```python
from datablock import Datablock

client = Datablock(api_key="your-api-key", project_id="your-project-id")

client.email.send(
    credential_id="your-credential-id",
    to=["alice@example.com", "bob@example.com"],
    subject="Hello from Datablock",
    html="<h1>Hello!</h1>",
)
```

### PHP

```php
use Datablock\Sdk\Datablock;

$client = new Datablock(apiKey: 'your-api-key', projectId: 'your-project-id');

$client->email->send(
    credentialId: 'your-credential-id',
    to: ['alice@example.com', 'bob@example.com'],
    subject: 'Hello from Datablock',
    html: '<h1>Hello!</h1>',
);
```

## Documentation

See the README in each language directory for full API reference:

- [JavaScript](./javascript/README.md)
- [Python](./python/README.md)
- [PHP](./php/README.md)

## License

[MIT](./LICENSE)
