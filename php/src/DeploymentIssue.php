<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * One problem found in a deployment file.
 *
 * Warnings are things the platform tolerates and an author probably did not
 * mean: a misspelled key that will be silently ignored, a field that still
 * works but has been superseded. They do not make a file invalid, because a
 * file written against a newer platform than this SDK knows about would
 * otherwise fail for saying something perfectly correct.
 */
final class DeploymentIssue
{
    public const SEVERITY_ERROR = 'error';
    public const SEVERITY_WARNING = 'warning';

    /**
     * @param string $path     Dot-joined location with list indices —
     *                         `services.0.envs.1.key`. `(root)` for the document.
     * @param string $message  What is wrong, written for whoever wrote the file.
     * @param string $severity One of the SEVERITY_* constants.
     */
    public function __construct(
        public readonly string $path,
        public readonly string $message,
        public readonly string $severity,
    ) {
    }

    /** Whether this finding makes the file invalid. */
    public function isError(): bool
    {
        return $this->severity === self::SEVERITY_ERROR;
    }
}
