# datablock/sdk

Official Datablock SDK for PHP.

## Installation

```bash
composer require datablock/sdk
```

## Usage

```php
use Datablock\Sdk\Datablock;

$client = new Datablock(
    apiKey: 'your-api-key',
    projectId: 'your-project-id',
);

// Send to a single recipient
$result = $client->email->send(
    credentialId: 'your-credential-id',
    to: 'recipient@example.com',
    subject: 'Hello from Datablock',
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

| Parameter    | Required | Default                      | Description                |
| ------------ | -------- | ---------------------------- | -------------------------- |
| `apiKey`     | Yes      | —                            | Your Datablock API key     |
| `projectId`  | Yes      | —                            | Your Datablock project ID  |
| `baseUrl`    | No       | `https://api.datablock.dev`  | API base URL override      |

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

\* At least one of `html` or `text` must be provided.

## Error Handling

```php
use Datablock\Sdk\Datablock;
use Datablock\Sdk\DatablockError;

try {
    $client->email->send(...);
} catch (DatablockError $e) {
    echo $e->errorCode; // e.g. "INSUFFICIENT_SCOPE"
    echo $e->status;    // e.g. 403
    echo $e->getMessage(); // Human-readable message
}
```
