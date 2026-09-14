<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * What {@see Deployment::validate()} reports.
 */
final class DeploymentValidationResult
{
    /**
     * @param bool                     $valid    No errors were found. Warnings do not
     *                                           clear this unless the check ran strict.
     * @param list<DeploymentIssue>    $issues   Every finding, in document order.
     * @param array<string,mixed>|null $template The file as the platform reads it —
     *                                           defaults applied, unknown keys dropped —
     *                                           or null when it could not be read as one.
     */
    public function __construct(
        public readonly bool $valid,
        public readonly array $issues,
        public readonly ?array $template,
    ) {
    }

    /**
     * Just the findings that make the file invalid.
     *
     * @return list<DeploymentIssue>
     */
    public function errors(): array
    {
        return array_values(array_filter($this->issues, static fn(DeploymentIssue $i) => $i->isError()));
    }

    /**
     * Just the findings the platform tolerates.
     *
     * @return list<DeploymentIssue>
     */
    public function warnings(): array
    {
        return array_values(array_filter($this->issues, static fn(DeploymentIssue $i) => !$i->isError()));
    }
}
