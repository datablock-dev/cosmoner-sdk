# @datablock/sdk

Official Datablock SDK for Node.js.

## Installation

```bash
npm install @datablock/sdk
```

## Usage

```typescript
import { Datablock } from "@datablock/sdk";

const client = new Datablock({
  apiKey: "your-api-key",
  projectId: "your-project-id",
});

// Send to a single recipient
const result = await client.email.send({
  credentialId: "your-credential-id",
  to: "recipient@example.com",
  subject: "Hello from Datablock",
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

| Option      | Required | Default                      | Description                |
| ----------- | -------- | ---------------------------- | -------------------------- |
| `apiKey`    | Yes      | —                            | Your Datablock API key     |
| `projectId` | Yes      | —                            | Your Datablock project ID  |
| `baseUrl`   | No       | `https://api.datablock.dev`  | API base URL override      |

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

\* At least one of `html` or `text` must be provided.

## Error Handling

```typescript
import { Datablock, DatablockError } from "@datablock/sdk";

try {
  await client.email.send({ ... });
} catch (err) {
  if (err instanceof DatablockError) {
    console.error(err.code);    // e.g. "INSUFFICIENT_SCOPE"
    console.error(err.status);  // e.g. 403
    console.error(err.message); // Human-readable message
  }
}
```
