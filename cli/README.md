# @cosmoner/cli

Command line tools for `.cosmoner/deployment.yaml`, the file you commit to
describe how a repository deploys on Cosmoner, for deploying image apps, and
for uploading to web hosting sites.

Everything except `cosmoner deploy` and `cosmoner upload` works offline. There is no account, no API
key and no network call — a check that reaches the network is a check that
fails when the network does, which is not what you want guarding a push.

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
| `--force` | Overwrite an existing file. |

### `cosmoner schema`

Prints the JSON Schema for the file, shipped with the CLI so it works offline.
`--url` prints the published URL instead — which is usually what an editor
wants, and what `cosmoner fmt` writes into the file.

```bash
cosmoner schema > .cosmoner/app.schema.json
```

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
| `--project <id>` | Defaults to `COSMONER_PROJECT_ID`. |
| `--no-wait` | Return once the deploy is accepted. |
| `--timeout <seconds>` | How long to wait for the rollout. Defaults to 600. |
| `--format text\|json` | `json` prints the app and the final deployment as one object. |

Credentials come from the environment, never a flag, so a key cannot end up in
a CI log: `COSMONER_API_KEY` (with `apps:read` and `apps:write`), and optionally
`COSMONER_PROJECT_ID` and `COSMONER_API_URL`.

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
| `--project <id>` | Defaults to `COSMONER_PROJECT_ID`. |
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
