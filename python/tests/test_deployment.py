"""Behaviour of the deployment validator that the shared fixtures do not pin."""

from __future__ import annotations

from cosmoner.deployment import (
    DEPLOYMENT_FILE_PATHS,
    MAX_DEPLOYMENT_BYTES,
    validate_deployment,
    validate_deployment_document,
)


def test_applies_the_defaults_the_platform_applies() -> None:
    result = validate_deployment("services:\n  - name: web\n")

    assert result.template == {
        "version": 1,
        "services": [{"name": "web", "type": "service"}],
    }


def test_drops_unknown_keys_as_the_platform_does() -> None:
    # The warning says the field is ignored; the template has to show it being
    # ignored, or the two halves of the answer disagree.
    result = validate_deployment("services:\n  - name: web\n    replicas: 3\n")

    assert result.template is not None
    assert result.template["services"][0] == {"name": "web", "type": "service"}
    assert [i.severity for i in result.issues] == ["warning"]


def test_warnings_alone_leave_a_file_valid() -> None:
    result = validate_deployment("services:\n  - name: web\n    prot: 3000\n")

    assert result.valid is True
    assert result.warnings and not result.errors


def test_strict_fails_the_same_file() -> None:
    result = validate_deployment(
        "services:\n  - name: web\n    prot: 3000\n", strict=True
    )

    assert result.valid is False
    # strict changes the verdict, not the finding — the field is still only a
    # warning as far as the platform is concerned.
    assert result.issues[0].severity == "warning"
    assert result.template is not None


def test_refuses_a_file_past_the_size_limit() -> None:
    result = validate_deployment("#" * (MAX_DEPLOYMENT_BYTES + 1))

    assert result.valid is False
    assert result.issues[0].message == "File exceeds the 64 KiB limit"


def test_measures_the_limit_in_bytes_not_characters() -> None:
    # A file of multi-byte characters is over the limit well before it is
    # MAX_DEPLOYMENT_BYTES characters long.
    result = validate_deployment("é" * (MAX_DEPLOYMENT_BYTES - 10))

    assert "exceeds" in result.issues[0].message


def test_reports_the_parsers_own_message_for_a_syntax_error() -> None:
    result = validate_deployment("services: [{name: web}\n")

    assert result.issues[0].path == "(root)"
    assert result.issues[0].message.startswith("Invalid YAML: ")


def test_does_not_read_arbitrary_python_tags() -> None:
    # The loader is a SafeLoader; a file that tries to construct an object is a
    # parse error, not an instantiation.
    result = validate_deployment(
        "services: !!python/object/apply:os.system ['echo hi']\n"
    )

    assert result.valid is False
    assert result.issues[0].message.startswith("Invalid YAML: ")


def test_checks_a_document_that_never_was_a_file() -> None:
    result = validate_deployment_document(
        {"services": [{"name": "web", "type": "static", "run_command": "npm start"}]}
    )

    assert result.valid is False
    assert [i.path for i in result.issues] == ["services.0.run_command"]


def test_treats_an_absent_document_as_an_empty_file() -> None:
    assert validate_deployment_document(None).issues[0].message == "File is empty"


def test_file_paths_put_the_documented_location_first() -> None:
    # The platform reads the first of these that exists, so the order is part of
    # the contract, not a list of equivalents.
    assert DEPLOYMENT_FILE_PATHS[0] == ".cosmoner/deployment.yaml"
    assert DEPLOYMENT_FILE_PATHS[-1] == ".datablock/app.yml"
