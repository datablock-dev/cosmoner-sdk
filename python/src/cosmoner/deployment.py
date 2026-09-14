"""Validation of ``.cosmoner/deployment.yaml``, the one file customers write by hand.

Entirely local: no API key, no network, nothing here that needs a ``Cosmoner``
client. It lives in the SDK rather than only in the CLI so the same check can
run inside a script that generates the file.

What it reports is what the platform will do with the file, which is not the
same as what the file says. The platform's parser is deliberately lenient — an
unknown key is dropped so a file written for a newer field still applies its
known settings against an older deploy — so an unknown key here is a warning
naming that consequence, and ``template`` comes back holding the settings that
will actually arrive.

The field table below is the third description of this format, after the
platform's Zod schema and the JSON Schema compiled from it. ``schemas/README.md``
explains why it is hand-written instead of fed to a JSON Schema validator, and
``tests/test_deployment_drift.py`` is what stops it drifting.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Union

import yaml

#: Where the platform serves the JSON Schema this table mirrors.
APP_SCHEMA_URL = "https://cosmoner.com/schemas/app.schema.json"

#: The format version this SDK reads.
DEPLOYMENT_VERSION = 1

#: Files larger than this are refused rather than parsed, as the platform does.
MAX_DEPLOYMENT_BYTES = 64 * 1024

#: Where the platform looks for the file, in order, when a repository is
#: selected in the deploy wizard. The first one that exists is the one that
#: counts — a second copy further down this list is never read.
#:
#: ``.datablock/app.*`` is the original location. It is still read and still
#: last, so apps already filled from it keep working; new files should not
#: use it.
DEPLOYMENT_FILE_PATHS: tuple[str, ...] = (
    ".cosmoner/deployment.yaml",
    ".cosmoner/deployment.yml",
    "deployment.yaml",
    "deployment.yml",
    ".datablock/app.yaml",
    ".datablock/app.yml",
)

_PathPart = Union[str, int]


class _Loader(yaml.SafeLoader):
    """A safe loader narrowed to the booleans YAML 1.2 recognises.

    PyYAML implements YAML 1.1, where ``yes``, ``no``, ``on`` and ``off`` are
    booleans. The platform reads these files with a YAML 1.2 parser, where they
    are ordinary strings, and so do the JavaScript and PHP SDKs. Left alone,
    this SDK would be the only one to call ``autodeploy: yes`` a boolean — and
    it would be telling a customer their file is fine while the platform reads
    something else from it.
    """


# Dropped rather than overridden: ``add_implicit_resolver`` appends, so adding a
# narrower boolean rule alongside PyYAML's own would leave ``yes`` matching the
# original. The entries have to go first, and they are rebuilt into a fresh dict
# so that SafeLoader itself — which other code in this process may be using — is
# left as it was.
_Loader.yaml_implicit_resolvers = {
    first_char: [
        (tag, regexp) for tag, regexp in resolvers if tag != "tag:yaml.org,2002:bool"
    ]
    for first_char, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}

_Loader.add_implicit_resolver(
    "tag:yaml.org,2002:bool",
    re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"),
    list("tTfF"),
)


@dataclass(frozen=True)
class DeploymentIssue:
    """One problem found in a deployment file.

    Warnings are things the platform tolerates and an author probably did not
    mean: a misspelled key that will be silently ignored, a field that still
    works but has been superseded. They do not make a file invalid, because a
    file written against a newer platform than this SDK knows about would
    otherwise fail for saying something perfectly correct.

    Attributes:
        path: Dot-joined location with list indices — ``services.0.envs.1.key``.
            ``(root)`` for the document itself.
        message: What is wrong, written for the person who wrote the file.
        severity: ``"error"`` or ``"warning"``.
    """

    path: str
    message: str
    severity: str


@dataclass(frozen=True)
class DeploymentValidationResult:
    """What :func:`validate_deployment` reports.

    Attributes:
        valid: No errors were found. Warnings do not clear this flag unless the
            check ran with ``strict=True``.
        issues: Every finding, in document order.
        template: The file as the platform reads it — defaults applied, unknown
            keys dropped — or ``None`` when it could not be read as one.
    """

    valid: bool
    issues: list[DeploymentIssue]
    template: dict[str, Any] | None

    @property
    def errors(self) -> list[DeploymentIssue]:
        """Just the findings that make the file invalid."""
        return [issue for issue in self.issues if issue.severity == "error"]

    @property
    def warnings(self) -> list[DeploymentIssue]:
        """Just the findings the platform tolerates."""
        return [issue for issue in self.issues if issue.severity == "warning"]


@dataclass(frozen=True)
class _Field:
    """One field's type and constraints.

    Keyword names mirror JSON Schema's, in snake_case, so that the drift test
    can walk this table and the published document side by side: ``min_length``
    is ``minLength``, ``choices`` is ``enum`` (which is a module name here).
    """

    kind: str
    required: bool = False
    deprecated: bool = False
    replaced_by: str | None = None
    default: str | int | None = None
    min_length: int | None = None
    max_length: int | None = None
    pattern: str | None = None
    #: Shown instead of a restatement of the pattern. A regex is not something
    #: to put in front of someone who mistyped a service name.
    pattern_message: str | None = None
    choices: Sequence[str] | None = None
    minimum: int | None = None
    maximum: int | None = None
    #: The single accepted value, for ``kind="const"``.
    value: int | None = None
    #: The message for a ``kind="const"`` mismatch.
    message: str | None = None
    fields: dict[str, _Field] | None = None
    min_items: int | None = None
    #: Replaces the generic "at least N" wording.
    min_items_message: str | None = None
    max_items: int | None = None
    item: _Field | None = None


#: How a variable's name may be written in the app's own environment.
_ENV_KEY_PATTERN = r"^[A-Za-z_][A-Za-z0-9_]*$"

#: How a stored secret or variable is named. Stricter than the above because it
#: is not this file's rule: it is what the vault accepts, so a reference that
#: could not name an existing secret is a typo worth catching before the push.
_REF_PATTERN = r"^[A-Z][A-Z0-9_]*$"

ENV_FIELDS: dict[str, _Field] = {
    "key": _Field(
        kind="string",
        required=True,
        min_length=1,
        max_length=256,
        pattern=_ENV_KEY_PATTERN,
        pattern_message=(
            "Env var keys must start with a letter or underscore and contain "
            "only letters, numbers, or underscores"
        ),
    ),
    "value": _Field(kind="string"),
    "secret": _Field(kind="boolean"),
    "from_variable": _Field(
        kind="string",
        min_length=1,
        max_length=100,
        pattern=_REF_PATTERN,
        pattern_message="from_variable must name a project variable, e.g. PUBLIC_API_URL",
    ),
    "from_secret": _Field(
        kind="string",
        min_length=1,
        max_length=100,
        pattern=_REF_PATTERN,
        pattern_message="from_secret must name a stored secret, e.g. DATABASE_PASSWORD",
    ),
}

BUILD_FIELDS: dict[str, _Field] = {
    "strategy": _Field(kind="string", choices=("nixpacks", "docker")),
    "command": _Field(kind="string", max_length=1024),
    "output_dir": _Field(kind="string", max_length=512),
}

SERVICE_FIELDS: dict[str, _Field] = {
    "name": _Field(
        kind="string",
        required=True,
        min_length=1,
        max_length=32,
        pattern=r"^[a-z0-9][a-z0-9-]*$",
        pattern_message=(
            "Service names must be lowercase letters, numbers, or hyphens, and "
            "start with a letter or number"
        ),
    ),
    "type": _Field(kind="string", choices=("service", "static"), default="service"),
    "source_dir": _Field(kind="string", max_length=512),
    "build": _Field(kind="object", fields=BUILD_FIELDS),
    "run_command": _Field(kind="string", max_length=1024),
    "port": _Field(kind="integer", minimum=1, maximum=65535),
    "http_port": _Field(
        kind="integer", minimum=1, maximum=65535, deprecated=True, replaced_by="port"
    ),
    "internal_port": _Field(
        kind="integer", minimum=1, maximum=65535, deprecated=True, replaced_by="port"
    ),
    "instance_size": _Field(kind="string", max_length=64),
    "instances": _Field(kind="integer", minimum=1, maximum=10),
    "autodeploy": _Field(kind="boolean"),
    "envs": _Field(
        kind="array", max_items=100, item=_Field(kind="object", fields=ENV_FIELDS)
    ),
}

ROOT_FIELDS: dict[str, _Field] = {
    "$schema": _Field(kind="string"),
    "version": _Field(
        kind="const",
        value=DEPLOYMENT_VERSION,
        message=(
            "Unsupported file version — this platform reads version "
            f"{DEPLOYMENT_VERSION} files"
        ),
        default=DEPLOYMENT_VERSION,
    ),
    "name": _Field(kind="string", max_length=100),
    "region": _Field(kind="string", max_length=32),
    "environment": _Field(
        kind="string", choices=("default", "development", "staging", "production")
    ),
    "services": _Field(
        kind="array",
        required=True,
        min_items=1,
        min_items_message="At least one service is required",
        max_items=10,
        item=_Field(kind="object", fields=SERVICE_FIELDS),
    ),
}


@dataclass
class _Issues:
    """Collects findings in the order they are produced."""

    all: list[DeploymentIssue] = field(default_factory=list)

    def error(self, path: Sequence[_PathPart], message: str) -> None:
        """Records a finding that makes the file invalid."""
        self.all.append(DeploymentIssue(_format_path(path), message, "error"))

    def warn(self, path: Sequence[_PathPart], message: str) -> None:
        """Records a finding the platform tolerates."""
        self.all.append(DeploymentIssue(_format_path(path), message, "warning"))


def _format_path(path: Sequence[_PathPart]) -> str:
    """Renders a location the way the conformance suite and the CLI expect it."""
    return ".".join(str(part) for part in path) if path else "(root)"


def _is_mapping(value: Any) -> bool:
    """Mapping-or-not. YAML gives lists as lists, so only dicts qualify."""
    return isinstance(value, dict)


def _is_integer(value: Any) -> bool:
    """True for a YAML integer. ``bool`` is an ``int`` in Python and is not one."""
    return isinstance(value, int) and not isinstance(value, bool)


def _check_value(
    value: Any, spec: _Field, path: Sequence[_PathPart], issues: _Issues
) -> Any:
    """Checks one value against its spec.

    Returns the value to carry into the parsed template, or ``None`` when it
    failed — which also takes it out of the cross-field rules below. A ``port``
    that is not a number has nothing useful to say about whether it conflicts
    with ``http_port``, and saying it anyway buries the one message worth
    reading.
    """
    if spec.kind == "string":
        if not isinstance(value, str):
            issues.error(path, "Expected a string")
            return None
        if spec.choices is not None and value not in spec.choices:
            issues.error(path, "Must be one of: " + ", ".join(spec.choices))
            return None
        if spec.min_length is not None and len(value) < spec.min_length:
            issues.error(path, "Must not be empty")
            return None
        if spec.max_length is not None and len(value) > spec.max_length:
            issues.error(path, f"Must be at most {spec.max_length} characters")
            return None
        if spec.pattern is not None and not re.match(spec.pattern, value):
            issues.error(path, spec.pattern_message or f"Must match {spec.pattern}")
            return None
        return value

    if spec.kind == "integer":
        if not _is_integer(value):
            issues.error(path, "Expected an integer")
            return None
        assert spec.minimum is not None and spec.maximum is not None
        if value < spec.minimum or value > spec.maximum:
            issues.error(path, f"Must be between {spec.minimum} and {spec.maximum}")
            return None
        return value

    if spec.kind == "boolean":
        if not isinstance(value, bool):
            issues.error(path, "Expected a boolean")
            return None
        return value

    if spec.kind == "const":
        if value != spec.value or isinstance(value, bool):
            issues.error(path, spec.message or "Unsupported value")
            return None
        return value

    if spec.kind == "object":
        if not _is_mapping(value):
            issues.error(path, "Expected a mapping")
            return None
        assert spec.fields is not None
        parsed = _check_mapping(value, spec.fields, path, issues)
        # The rules that span more than one field run as part of the mapping
        # they belong to, so a bad variable is reported above the service
        # holding it rather than in a second pass at the end.
        #
        # Matched on the table itself rather than declared in it, so the field
        # definitions stay what they claim to be — a description comparable
        # line for line against the published JSON Schema — instead of also
        # carrying behaviour. The root's rule is invoked by
        # validate_deployment_document, which is where the walk starts.
        if spec.fields is ENV_FIELDS:
            _check_env_var(parsed, value, path, issues)
        elif spec.fields is SERVICE_FIELDS:
            _check_service(parsed, value, path, issues)
        return parsed

    if spec.kind == "array":
        if not isinstance(value, list):
            issues.error(path, "Expected a list")
            return None
        if spec.min_items is not None and len(value) < spec.min_items:
            issues.error(
                path,
                spec.min_items_message or f"Must have at least {spec.min_items} items",
            )
            return None
        if spec.max_items is not None and len(value) > spec.max_items:
            issues.error(path, f"Must have at most {spec.max_items} items")
            return None
        assert spec.item is not None
        return [
            _check_value(item, spec.item, [*path, index], issues)
            for index, item in enumerate(value)
        ]

    raise ValueError(f"Unknown field kind {spec.kind!r}")


def _check_mapping(
    value: dict[str, Any],
    table: dict[str, _Field],
    path: Sequence[_PathPart],
    issues: _Issues,
) -> dict[str, Any]:
    """Checks a mapping's keys against a field table.

    Unknown keys are reported first so a typo appears above the fields it sits
    among, then the known fields in table order, so output reads down the file
    rather than in whatever order the rules happen to fire.
    """
    for key in value:
        if key not in table:
            issues.warn([*path, key], f'Unknown field "{key}" — it will be ignored')

    parsed: dict[str, Any] = {}
    for key, spec in table.items():
        field_path = [*path, key]
        if value.get(key) is None:
            if spec.required:
                issues.error(field_path, "Required")
            elif spec.default is not None:
                parsed[key] = spec.default
            continue
        if spec.deprecated and spec.replaced_by:
            issues.warn(field_path, f"{key} is deprecated — use {spec.replaced_by}")
        checked = _check_value(value[key], spec, field_path, issues)
        if checked is not None:
            parsed[key] = checked
    return parsed


def _check_env_var(
    env: dict[str, Any],
    raw: dict[str, Any],
    path: Sequence[_PathPart],
    issues: _Issues,
) -> None:
    """Rules spanning more than one field of an ``envs`` entry.

    A variable takes its value from exactly one place. Two sources is not a
    merge with a winner — it is a file whose author believed something the
    platform does not do — so it is refused rather than quietly resolved.

    Which sources were given is read from ``raw``, not from the checked values:
    a ``from_variable`` that failed its pattern is still a source the author
    supplied, and answering a typo in it with "set one of value, secret,
    from_variable, or from_secret" buries the message that would fix the file.
    """

    def supplied(key: str) -> bool:
        # `secret: false` says the variable is not sensitive; it is not an
        # attempt to give it a value, so it does not count as a source.
        if key == "secret":
            return raw.get("secret") is True
        return raw.get(key) is not None

    sources = [
        key
        for key in ("value", "secret", "from_variable", "from_secret")
        if supplied(key)
    ]

    if not sources:
        issues.error(
            [*path, "value"], "Set one of value, secret, from_variable, or from_secret"
        )
        return
    if len(sources) > 1:
        issues.error(
            [*path, sources[1]],
            "A variable takes its value from one place only — remove "
            + ", ".join(sources[1:]),
        )
    # ``secret: true`` with a value is the mistake this check exists for: a
    # credential committed to the repository. Said plainly and separately, so
    # the author knows to rotate it rather than just to delete a line.
    if env.get("secret") is True and env.get("value") is not None:
        issues.error(
            [*path, "value"],
            "A secret value must not be committed — remove value, or link a "
            "stored secret with from_secret",
        )


def _check_service(
    service: dict[str, Any],
    _raw: dict[str, Any],
    path: Sequence[_PathPart],
    issues: _Issues,
) -> None:
    """Rules spanning more than one field of a service."""
    is_static = service.get("type") == "static"
    build = service.get("build") if _is_mapping(service.get("build")) else None

    if is_static and service.get("run_command") is not None:
        issues.error([*path, "run_command"], "Static sites cannot define a run_command")
    if not is_static and build is not None and build.get("output_dir") is not None:
        issues.error(
            [*path, "build", "output_dir"], "output_dir only applies to static sites"
        )
    # A static site not built from its own Dockerfile runs the platform's image,
    # whose port is not the customer's to choose.
    strategy = build.get("strategy") if build is not None else None
    if is_static and strategy != "docker" and service.get("port") is not None:
        issues.error(
            [*path, "port"],
            "port does not apply to a static site — the platform serves it",
        )

    legacy = [
        key for key in ("http_port", "internal_port") if service.get(key) is not None
    ]
    if service.get("port") is not None and legacy:
        issues.error(
            [*path, legacy[0]],
            "port replaces "
            + " and ".join(legacy)
            + " — remove "
            + ("it" if len(legacy) == 1 else "them"),
        )

    envs = service.get("envs")
    if isinstance(envs, list):
        seen = set()
        for index, env in enumerate(envs):
            if not _is_mapping(env) or not isinstance(env.get("key"), str):
                continue
            if env["key"] in seen:
                issues.error(
                    [*path, "envs", index, "key"],
                    f'Duplicate environment variable "{env["key"]}"',
                )
            seen.add(env["key"])


def _check_root(
    document: dict[str, Any], path: Sequence[_PathPart], issues: _Issues
) -> None:
    """Rules spanning more than one field of the document itself."""
    services = document.get("services")
    if not isinstance(services, list):
        return

    seen = set()
    for index, service in enumerate(services):
        if not _is_mapping(service) or not isinstance(service.get("name"), str):
            continue
        if service["name"] in seen:
            issues.error(
                [*path, "services", index, "name"],
                f'Duplicate service name "{service["name"]}"',
            )
        seen.add(service["name"])


def _result(
    issues: _Issues, template: dict[str, Any] | None, strict: bool
) -> DeploymentValidationResult:
    """Assembles the result.

    ``template`` follows the errors rather than ``valid``: it is what the
    platform would read, which ``strict`` does not change — strict is about what
    this caller is willing to let through, not about what the platform does.
    """
    has_errors = any(issue.severity == "error" for issue in issues.all)
    blocking = bool(issues.all) if strict else has_errors
    return DeploymentValidationResult(
        valid=not blocking,
        issues=issues.all,
        template=None if has_errors else template,
    )


def validate_deployment_document(
    document: Any, *, strict: bool = False
) -> DeploymentValidationResult:
    """Validates an already-parsed document.

    Use this when the file did not come from disk — generated from a template,
    or read out of a repository through some other client.
    :func:`validate_deployment` is the same check with the YAML parsing in front
    of it.

    Args:
        document: The parsed mapping, or ``None`` for an empty file.
        strict: Treat warnings as errors, for a CI check that should not let
            typos through.
    """
    issues = _Issues()

    if document is None:
        issues.error([], "File is empty")
        return _result(issues, None, strict)
    if not _is_mapping(document):
        issues.error([], "Expected a mapping at the top level of the file")
        return _result(issues, None, strict)

    parsed = _check_mapping(document, ROOT_FIELDS, [], issues)
    _check_root(parsed, [], issues)

    return _result(issues, parsed, strict)


def validate_deployment(
    source: str, *, strict: bool = False
) -> DeploymentValidationResult:
    """Reads and validates the contents of a deployment file.

    Args:
        source: The file as written — the raw text, not a parsed object.
        strict: Treat warnings as errors, for a CI check that should not let
            typos through.

    Returns:
        Every finding, and the file as the platform would read it.
    """
    issues = _Issues()

    if len(source.encode("utf-8")) > MAX_DEPLOYMENT_BYTES:
        issues.error([], f"File exceeds the {MAX_DEPLOYMENT_BYTES // 1024} KiB limit")
        return _result(issues, None, strict)

    try:
        document = yaml.load(source, Loader=_Loader)
    except yaml.YAMLError as err:
        issues.error([], f"Invalid YAML: {err}")
        return _result(issues, None, strict)

    return validate_deployment_document(document, strict=strict)
