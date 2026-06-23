# datablock-sdk

Official Datablock SDK for Python.

## Installation

```bash
pip install datablock-sdk
```

## Usage

```python
from datablock import Datablock

client = Datablock(
    api_key="your-api-key",
    project_id="your-project-id",
)

# Send to a single recipient
result = client.email.send(
    credential_id="your-credential-id",
    to="recipient@example.com",
    subject="Hello from Datablock",
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

| Parameter    | Required | Default                      | Description                |
| ------------ | -------- | ---------------------------- | -------------------------- |
| `api_key`    | Yes      | —                            | Your Datablock API key     |
| `project_id` | Yes      | —                            | Your Datablock project ID  |
| `base_url`   | No       | `https://api.datablock.dev`  | API base URL override      |

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

\* At least one of `html` or `text` must be provided.

## Error Handling

```python
from datablock import Datablock, DatablockError

try:
    client.email.send(...)
except DatablockError as e:
    print(e.code)    # e.g. "INSUFFICIENT_SCOPE"
    print(e.status)  # e.g. 403
    print(str(e))    # Human-readable message
```
