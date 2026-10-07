# @cosmoner/cli

Command line tools for `.cosmoner/deployment.yaml`, the file you commit to
describe how a repository deploys on Cosmoner, for deploying image apps, and
for uploading to web hosting sites.

The file commands — `validate`, `fmt`, `init`, `schema` and `agents` — work
offline. There is no account, no API key and no network call: a check that
reaches the network is a check that fails when the network does, which is not
what you want guarding a push. `deploy`, `upload`, `secrets` and `variables` talk to the API
by nature, and only they read a credential — from `cosmoner login` on your own
machine, or `COSMONER_API_KEY` in CI.

```bash
npx @cosmoner/cli validate
```

No install needed, and nothing about it is JavaScript-specific: the file
describes a deployment, not a Node project, so this is as useful in a Go or
Rust repository as in a JavaScript one.

## Commands

### `cosmoner validate [file...]`

Checks a deployment file against the format the platform reads. With no
argument it finds the file the way the platform does — the first of
`.cosmoner/deployment.yaml`, `.cosmoner/deployment.yml`, `deployment.yaml`,
`deployment.yml` that exists.

```
$ cosmoner validate
.cosmoner/deployment.yaml
  2:11  error    Service names must be lowercase letters, numbers, or hyphens, and start with a letter or number  services.0.name
  4:18  error    Static sites cannot define a run_command  services.0.run_command
  5:11  warning  Unknown field "prot" — it will be ignored  services.0.prot

2 errors, 1 warning
```

| Option | |
| --- | --- |
| `--strict` | Fail on warnings too. |
| `--format text\|json\|github` | `github` emits workflow commands, so findings land on the diff. |
| `--quiet` | Report through the exit code alone. |
| `--no-color` | Never colourise. Colour is off already when output is not a terminal, and `NO_COLOR` is honoured. |

Exit codes: `0` everything passed, `1` a file did not, `2` the command itself
was wrong — an unknown option, an unreadable path. A CI job that treats any
non-zero code as a failing deployment file would otherwise report a typo in its
own command line as a broken deploy.

#### Errors and warnings

A warning is something the platform tolerates and you probably did not mean.
Unknown keys are the main one: the platform drops them rather than rejecting
them, so that a file written for a newer field still applies its known settings
against an older deploy. That leniency is deliberate, and treating it as fatal
here would reject files the platform accepts — so an unknown key is a warning
that says what will happen to it.

Use `--strict` when you would rather not let a typo through. It changes the
verdict, not the finding: the field is still only a warning as far as the
platform is concerned.

#### In GitHub Actions

```yaml
- name: Validate deployment file
  run: npx @cosmoner/cli validate --strict --format github
```

### `cosmoner fmt [file...]`

Rewrites the file in canonical form: fields in the order the format documents
them, consistent indentation, and a `$schema` header so your editor validates
and completes the file as you type.

Comments are kept and travel with the field they were written against. Unknown
fields are kept too — the platform ignores them rather than rejecting them, and
deleting something the CLI does not recognise is not a formatter's decision —
and move to the end of the mapping they are in.

| Option | |
| --- | --- |
| `--check` | Do not write; exit 1 if any file would change. |
| `--stdout` | Print the result instead of writing it back. |

### `cosmoner init [file]`

Writes a starter file at `.cosmoner/deployment.yaml`, with the schema header and
comments covering the fields you are most likely to set.

| Option | |
| --- | --- |
| `--name <name>` | Service name. Defaults to `web`. |
| `--type service\|static` | Defaults to `service`. |
| `--agents` | Also write the Cosmoner section into `AGENTS.md`, as `cosmoner agents` does. |
| `--force` | Overwrite an existing deployment file. `AGENTS.md` is never overwritten, only the section in it. |

`init` writes everything it was asked to or nothing: an existing deployment
file without `--force` is refused before `AGENTS.md` is touched. On a project
that already has a deployment file, run `cosmoner agents` instead.

### `cosmoner agents [file]`

Writes a short "Deploying to Cosmoner" section into `AGENTS.md`, the file
coding agents such as Codex and Cursor read for a repository's instructions, so
an agent working in the repository validates the deployment file, deploys and
handles secrets the way this CLI expects instead of guessing. It names the
deployment file the platform would read, the `validate`, `fmt`, `deploy` and
`upload` invocations with `--format json`, the exit codes, where credentials
come from, that secrets are write-only, and where the docs, `llms.txt` and the
docs MCP server are.

The section sits between `<!-- cosmoner:start -->` and `<!-- cosmoner:end -->`.
Running the command again replaces only what is between the markers, so it is
safe to re-run after upgrading the CLI; the rest of the file is never touched.
A file without the markers gets the section appended, and a missing file is
created. Markers that do not pair up are refused with exit code `1` and the
file is left as it was.

Claude Code reads `CLAUDE.md` rather than `AGENTS.md`: add a line `@AGENTS.md`
to `CLAUDE.md` to import it, or pass `CLAUDE.md` as the file.

### `cosmoner schema`

Prints the JSON Schema for the file, shipped with the CLI so it works offline.
`--url` prints the published URL instead — which is usually what an editor
wants, and what `cosmoner fmt` writes into the file.

```bash
cosmoner schema > .cosmoner/app.schema.json
```

### `cosmoner login`

Signs the CLI in through your browser. The terminal shows a code and opens
`cosmoner.com/cli/<code>`, where you check the code matches and approve. The
CLI is then signed in to your account, the way your browser is, and reaches
every project you are a member of. The login is saved to
`~/.config/cosmoner/credentials.json`, readable only by you.

```
$ cosmoner login
Your code is BCDF-GHJK

Opened https://cosmoner.com/cli/BCDF-GHJK in your browser.
Or go to https://cosmoner.com/cli and enter the code.

Waiting for approval…

Logged in as dana@example.com, until 2026-11-06 at the latest.
Pick a default project with cosmoner use <project>, or pass --project to each command.
```

The login acts as you: it can do what your role allows in each project.
Members, API keys and billing stay in the control panel. It renews itself while you use it
and ends after 7 days unused or 30 days after approval. Each machine is listed
under **Account → Security**, where you can sign it out. `--no-browser` prints
the link instead of opening it, for a machine reached over SSH.

A login saved by an older CLI is an API key for one project. It keeps working
until it expires; run `cosmoner login` to replace it with a session.

`COSMONER_API_KEY` always takes priority over a saved login, so CI keeps using
the key it was given. There is deliberately no flag for passing a key or a
token: a flag ends up in shell history and CI logs.

### `cosmoner use <project>`

Sets the project that `deploy`, `upload`, `secrets` and `variables` act on.
`<project>` is a slug or an id, and is checked against the API. A command takes
the first of `--project`, `COSMONER_PROJECT_ID`, and this default.

```
$ cosmoner use acme-web
Using Acme Web (acme-web) by default.
```

`cosmoner use` alone shows the default; `--clear` removes it.

### `cosmoner whoami` and `cosmoner logout`

`cosmoner whoami` shows who the CLI is signed in as, when the login ends and
the default project, after checking the login still works. `cosmoner logout`
signs this machine out and deletes the saved login.

### `cosmoner <product> get [<name>]`

Reads what a project has. With no name it lists everything; with one it shows
that item. `list` is the same as `get` with no name.

```
$ cosmoner apps get
NAME  STATUS  URL                       SOURCE                              CREATED
web   ACTIVE  https://web.cosmoner.app  registry.cosmoner.com/acme/web:v2   2026-09-01
api   ACTIVE  -                         acme/api                            2026-08-14

$ cosmoner databases get main --format json
```

Products: `projects`, `apps`, `servers`, `ssh-keys`, `databases`, `redis`,
`domains`, `buckets`, `registries`, `email`, `iam`, `members`, `hosting`,
`webhooks`, `secrets` and `variables`. `cosmoner projects get` lists every
project you can reach and needs no project; the rest read the project from
`--project`, `COSMONER_PROJECT_ID` or `cosmoner use`.

`--format json` prints the API's own objects — an array for a listing, one
object for a single item — so scripts and AI agents can rely on the shape the
API documents rather than on the table layout.

Credentials are never printed, in either format. A database's connection URI,
a Redis password, or a password inside any URL shows as `[hidden]`; fetch one
on purpose from the control panel or the SDK when you need it.

`cosmoner apps logs <app> [--type run|build]` prints an app's recent log lines,
with the same masking.

### `cosmoner get --all`

Everything a project has in one command: every product's listing, read in
parallel. In text it prints a section per product; `--format json` prints one
object, with `project`, a key per product holding its listing, and `errors`.

```json
{
  "project": { "id": "…", "name": "Acme", "slug": "acme" },
  "apps": [ … ],
  "servers": [],
  "iam": null,
  "errors": { "iam": "Missing scope iam:read (FORBIDDEN)" }
}
```

A product the credential may not read — an API key without that product's read
scope — is `null`, with the reason under `errors`, and the command still
succeeds. It exits 1 only when nothing could be read. A CLI login reads every
product its user can see.

### Ordering

`cosmoner <product> create <name>` orders a paid resource. It prices the order
with the API first, shows the price, and asks:

```
$ cosmoner redis create cache --plan valkey-1gb
This orders Redis "cache": plan valkey-1gb in se-sto.
It costs $12.00 a month before tax, billed to the project's saved card. About $4.50 is charged now, prorated until 25 Oct 2026.
Order Redis "cache"? [y/N]
```

The monthly price is exact. What is charged now is an estimate once the
project already pays for something, because the charge is prorated onto the
existing subscription. As with deletes, `--yes` answers in advance, and with no
terminal and no `--yes` nothing is ordered and the command exits 2.

| Command | Lists the choices |
| --- | --- |
| `cosmoner servers create <name> --size <size> --region <region> [--image <image>] [--ssh-keys <key,…>]` | `servers sizes`, `servers regions`, `servers images` |
| `cosmoner redis create <name> --plan <plan> [--region] [--persistence <mode>]` | `redis plans`, `redis regions` |
| `cosmoner databases create <name> --size <size> [--version] [--region]` | `databases sizes` |
| `cosmoner buckets create <name> --region <aws-region> [--tier] [--public] [--versioning] [--cdn]` | |
| `cosmoner registries create <name> --region <region> [--provider]` | `registries providers` |
| `cosmoner hosting create <site> [--tier] [--php] [--database <name>] [--extra-storage <gb>]` | `hosting plans` |
| `cosmoner apps create <name> --size <size> (--image <image> \| --repo <owner/repo>) [options]` | `apps sizes`, `apps regions` |
| `cosmoner apps resize <app> --size <size>` | `apps sizes` |

A region is optional wherever only one is open. A name already in use is
refused before anything is priced. `--format json` prints `{ created, price }`.

### Changing and deleting

`cosmoner <product> delete <name>` (or `rm`) deletes one item for good,
resolving the name as `get` does. It says what goes with the item and asks
first:

```
$ cosmoner redis delete cache
This deletes redis "cache". Its data goes with it, and its billing stops. It cannot be undone.
Delete redis "cache"? [y/N]
```

`--yes` answers in advance, for scripts. With no terminal and no `--yes` — CI,
or an agent's shell — it changes nothing and exits 2, rather than waiting on
an answer that cannot come.

Every product except `members` can be deleted; a project only once it holds
no resources, and only by its owner. The other write commands are:

| Command | |
| --- | --- |
| `cosmoner ssh-keys create <name> --public-key <file\|->` | Adds a public key. |
| `cosmoner domains create <domain>` | Adds a domain you own and prints the TXT record to publish. |
| `cosmoner domains verify <domain>` | Checks that record; exits 1 until it is visible. |
| `cosmoner apps update <app> [options]` | Changes name, instances, build and run commands, ports, auto-deploy and the image deploy policy. An empty value clears a setting. |
| `cosmoner webhooks create <name> --url <url> --events <event,…>` | Creates an endpoint and prints its signing secret. |
| `cosmoner webhooks update <webhook> [options]` | Changes it; `--enable` and `--disable` switch it on and off. |
| `cosmoner webhooks test <webhook> [--event <event>]` | Sends a sample event; exits 1 when the delivery failed. |
| `cosmoner webhooks rotate-secret <webhook>` | Replaces the signing secret, after asking. |
| `cosmoner servers update <server> --name <name>` / `projects update <project> --name <name>` | Renames it. |
| `cosmoner servers start\|stop\|reboot <server>` | Powers it on, cuts its power or restarts it; stop and reboot ask first. A stopped server is still billed. |
| `cosmoner email create <domain>` | Sets a domain up for sending and prints the DNS records to publish. A domain not yet in the project is added as pending. |
| `cosmoner email verify <domain>` | Checks those records and turns sending on; exits 1 until they are all visible. Asks first when it would start billing an email plan with a monthly price. |

### Credentials

These print a secret exactly once — the API keeps no copy, or only a hash —
so save it from the command's output. Every read shows it as `[hidden]`.

| Command | Prints |
| --- | --- |
| `cosmoner iam create <label> [--storage read\|write] [--buckets <bucket,…>] [--registry pull\|push] [--repositories <repo,…>]` | An access key ID and its secret access key, for object storage, the registry or both. Without `--buckets` or `--repositories` it reaches every bucket or repository, including later ones. |
| `cosmoner email credentials create <domain> --label <label> --from <address>` | An SMTP username and password, and the server to send through. |
| `cosmoner ssh-keys generate <name> [--out <file>]` | An RSA private key — or, with `--out`, writes it to `<file>` (mode 600) and `<file>.pub` and prints neither. |
| `cosmoner webhooks create` / `rotate-secret` | The signing secret. |
| `cosmoner databases rotate-password <database>` | A shared database's new password and connection URI, after asking: the old password stops working at once. |

`cosmoner email credentials delete <domain> <credential>` removes an SMTP
login, after asking. `cosmoner iam delete` removes an access key.

### `cosmoner deploy <app>`

Deploys an image app — one that runs an image from a Cosmoner registry — and
waits for the rollout to finish. `<app>` is the app's name or id. Apps built
from a repository deploy by pushing to their branch, so this refuses them.

```
$ cosmoner deploy web --tag v2
Deploying web (tag v2)
  PENDING
  DEPLOYING
✓ web is live on registry.cosmoner.com/acme/web:v2 after 41s
```

With neither `--tag` nor `--digest`, the image the app already names is pulled
again, which picks up a tag that was pushed over.

| Option | |
| --- | --- |
| `--tag <tag>` | Deploy this tag from the app's repository. A commit SHA pushed as a tag goes here. |
| `--digest <digest>` | Deploy this exact image. The `sha256:` prefix may be left off. |
| `--project <project>` | Slug or id. Defaults to `COSMONER_PROJECT_ID`, then the project set with `cosmoner use`. |
| `--no-wait` | Return once the deploy is accepted. |
| `--timeout <seconds>` | How long to wait for the rollout. Defaults to 600. |
| `--format text\|json` | `json` prints the app and the final deployment as one object. |

Credentials come from `cosmoner login` or the environment, never a flag, so a
key cannot end up in a CI log: `COSMONER_API_KEY` (with `apps:read` and
`apps:write`), and optionally `COSMONER_PROJECT_ID` and `COSMONER_API_URL`.

Exit codes: `0` the deploy went live (or was accepted, with `--no-wait`), `1` it
failed, timed out or the API refused it, `2` the command itself was wrong. A
timeout stops the wait, not the deploy.

#### In GitHub Actions

```yaml
- name: Deploy
  run: npx @cosmoner/cli deploy web --tag ${{ github.sha }}
  env:
    COSMONER_API_KEY: ${{ secrets.COSMONER_API_KEY }}
    COSMONER_PROJECT_ID: ${{ vars.COSMONER_PROJECT_ID }}
```

### `cosmoner upload <site> <dir>`

Uploads the contents of `<dir>` to a web hosting site over SFTP. `<site>` is the
site's name or id. The SFTP login is fetched with the API key, so a CI job
needs no password of its own.

```
$ cosmoner upload my-site dist --delete
Uploading dist to my-site:/my-site.cosmoner.com/public_html (42 files, 1.3 MB)
✓ Uploaded 42 files (1.3 MB), removed 3 in 6s
```

Every file is uploaded and existing ones are overwritten; files already on the
site but not in `<dir>` are left alone unless `--delete` is given. `.git`
folders and symlinks are never uploaded. An empty `<dir>` is refused, since it
is usually a build that produced nothing.

| Option | |
| --- | --- |
| `--remote <path>` | Folder to upload into, as an SFTP client shows it. Defaults to the one the site's own hostname serves. |
| `--delete` | Afterwards, remove what is under the target but not in `<dir>`. Refused when the target is `/`. |
| `--dry-run` | Connect and list what would change, changing nothing. |
| `--host-key <sha256>` | Refuse a server whose host key has another fingerprint. Defaults to `COSMONER_SFTP_HOST_KEY`. |
| `--project <project>` | Slug or id. Defaults to `COSMONER_PROJECT_ID`, then the project set with `cosmoner use`. |
| `--format text\|json` | `json` prints the site, target and the files uploaded and removed. |

The key needs `hosting:read`. Without a pinned host key the upload goes ahead
and prints the fingerprint it saw; pin it, and a server presenting another key
is refused before the password is sent. The gateway's key is:

```
SHA256:PfqYSl1pbMjfMKAbcmjzGZ0t1kpuCZ2mtymdyLu9HwA
```

Exit codes: `0` every file was uploaded, `1` the upload failed or the API
refused it, `2` the command itself was wrong.

#### In GitHub Actions

```yaml
- name: Upload site
  run: npx @cosmoner/cli upload my-site dist --delete
  env:
    COSMONER_API_KEY: ${{ secrets.COSMONER_API_KEY }}
    COSMONER_PROJECT_ID: ${{ vars.COSMONER_PROJECT_ID }}
    COSMONER_SFTP_HOST_KEY: SHA256:PfqYSl1pbMjfMKAbcmjzGZ0t1kpuCZ2mtymdyLu9HwA
```

### `cosmoner secrets <list|set|rm>`

Manages the values a deployment file refers to with `from_secret`. A secret's
value is encrypted and returned only as it is set, so this command never prints
one back — the value it would print is the value you just supplied, and putting
it on stdout writes it into a CI log.

```
$ cosmoner secrets list
NAME            ENVIRONMENT  VERSION  UPDATED
DB_PASSWORD     production   2        2026-09-02
STRIPE_KEY      production   1        2026-08-30

$ cosmoner secrets set DB_PASSWORD --environment production < password.txt
✓ Set DB_PASSWORD to hu••••r3 in production, version 2
```

`set` stores a new secret, or replaces the value of one that already exists in
the same environment. `rm` takes the same name.

| Option | |
| --- | --- |
| `--environment <env>` | `default` (the default), `development`, `staging` or `production`. `set` and `rm` address one name in one environment; a bare `list` shows them all. |
| `--value <value>` | The value to store, taken literally. |
| `--from-file <path>` | Read the value from a file. One trailing newline is stripped. |
| `--description <text>` | Set alongside the value. |
| `--project <id>` | Project to work in. Defaults to `COSMONER_PROJECT_ID`. |
| `--format text\|json` | `json` never includes a value. |

The value comes from `--value`, `--from-file`, or whatever is piped in, in that
order. **Piping is safest**: a value passed as `--value` is recoverable from
shell history and may be echoed by a CI runner. Stdin is the last resort rather
than a competing source, because a CI runner often hands a command a
non-terminal stdin with nothing behind it.

Two API behaviours will otherwise look like bugs:

- **Writing needs the key's owner to be an owner or admin** of the project. The
  scope alone is not enough, so a member's key with `secrets:write` still gets
  a 403.
- **Creating is rate-limited** to 100 secrets per project every 10 minutes,
  shared by every key and machine working on the project. Past that, creating
  meets a 429 until the window resets.

Exit codes: `0` the change was made, `1` the API refused it or the name was not
found, `2` the command itself was wrong.

#### In GitHub Actions

```yaml
- name: Publish the build's database password
  run: echo "$DB_PASSWORD" | npx @cosmoner/cli secrets set DB_PASSWORD --environment production
  env:
    COSMONER_API_KEY: ${{ secrets.COSMONER_API_KEY }}
    COSMONER_PROJECT_ID: ${{ vars.COSMONER_PROJECT_ID }}
    DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
```

### `cosmoner variables <list|set|rm>`

The plaintext sibling of `cosmoner secrets`, for the non-sensitive values a
deployment file refers to with `from_variable`. Same subcommands and same
options; the difference is that a variable's value is returned on every read,
so `list` prints it.

```
$ cosmoner variables set LOG_LEVEL --value debug --environment development
✓ Created LOG_LEVEL=debug in development
```

Anything worth hiding belongs in `cosmoner secrets` instead.

## Update notices

When a newer CLI is out, a one-line notice follows a command's output — at
most once a day, on stderr. The CLI asks npm for the latest version at most
once a day too, and gives up after a second and a half rather than hold a
command up. There is no notice, and no lookup, in CI, when stderr is not a
terminal, for the offline file commands, or when `COSMONER_NO_UPDATE_CHECK`
is set.

## Same answer as the SDKs

The rules live in the SDK, not here. `@cosmoner/sdk`, `cosmoner-sdk` (Python)
and `cosmoner/sdk` (PHP) all expose the same validator, run against the same
fixtures in `conformance/`, asserting the same issues with the same messages in
the same order. Validating in CI with this CLI and again in a deployment script
with the Python SDK gives you one answer, not two.

The CLI adds only what needs a file to exist: the line and column each finding
sits on, and the choice of output format.

## Development

The CLI bundles the JavaScript SDK's **source** rather than depending on the
published package. `tsup` inlines it at build time, resolved through the `paths`
entry in `tsconfig.json`.

That is worth knowing before changing it. Depending on `@cosmoner/sdk` by
version would mean the CLI could only ever be built against an SDK that had
already shipped — every change spanning both would need two releases in order,
and CI would test the CLI against a registry version rather than the one in the
commit. Bundling keeps the two in step, and a CLI is a program to run rather
than a library to link, so shipping one self-contained file is also the better
end result. The cost is that `cli/` reaches into `../javascript/src`, so a
change to the SDK re-runs the CLI's tests and re-releases the CLI.

```bash
cd javascript && npm ci   # the type check reads the SDK's source, so it
cd ../cli && npm ci       # needs the SDK's dependencies resolvable too
npm run lint && npm run typecheck && npm test
```

The first line is not optional for `npm run typecheck`: tsc follows
`../javascript/src` and that source imports `yaml`, which module resolution
looks for beside the importing file rather than in `cli/node_modules`. Lint,
build and test do not need it — tsup treats `yaml` as external because the CLI
depends on it as well. `ssh2` is bundled but its two optional native addons
are left out, see `tsup.config.ts`.

`npm test` builds first, because two things only exist after a build: the JSON
Schema copied next to the bundle, and the shebang that makes it runnable. Both
are covered by `test/e2e.test.ts`, which runs the built binary.

## License

[MIT](../LICENSE)
