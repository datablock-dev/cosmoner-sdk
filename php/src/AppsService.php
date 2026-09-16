<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use Closure;
use InvalidArgumentException;
use RuntimeException;
use stdClass;

/** App lookup and image deploy operations for a project. */
class AppsService
{
    /** Phases after which a deployment will not change again. */
    public const FINISHED_DEPLOYMENT_PHASES = ['ACTIVE', 'ERROR', 'CANCELED', 'SUPERSEDED'];

    public const DEFAULT_POLL_INTERVAL = 3.0;
    public const DEFAULT_WAIT_TIMEOUT = 600.0;

    // Docker's tag grammar and the digest form, matching what the API accepts, so a
    // malformed value fails before it spends a request against the deploy budget.
    private const TAG_PATTERN = '/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/';
    private const DIGEST_PATTERN = '/^sha256:[a-f0-9]{64}$/';

    /** @var Closure(float): void */
    private readonly Closure $sleep;

    /** @var Closure(): float */
    private readonly Closure $clock;

    /**
     * Creates the service; `$sleep` and `$clock` exist so tests can poll without waiting.
     *
     * @param (Closure(float): void)|null $sleep Pauses for the given number of seconds.
     * @param (Closure(): float)|null     $clock Returns the current time in seconds.
     */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
        ?Closure $sleep = null,
        ?Closure $clock = null,
    ) {
        $this->sleep = $sleep ?? static function (float $seconds): void {
            usleep((int) round($seconds * 1_000_000));
        };
        $this->clock = $clock ?? static fn (): float => microtime(true);
    }

    /**
     * Lists every app in the project, newest first.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: array<int, array<string, mixed>>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: array<int, array<string, mixed>>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Starts deploying an image app and returns the deployment without waiting.
     *
     * Pass `$tag` or `$digest` to roll onto that image from the repository the
     * app already pulls from, or neither to re-resolve the image the app names
     * now. Only image apps pulling from a Cosmoner registry can be deployed this
     * way; the API rejects apps built from a repository. Pair with
     * `waitForDeployment()` to learn whether the rollout succeeded.
     *
     * @param ?string $digest `sha256:` followed by 64 hex characters.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function deploy(
        string $appId,
        ?string $tag = null,
        ?string $digest = null,
        ?string $projectId = null,
    ): array {
        self::requireAppId($appId);
        if ($tag !== null && $digest !== null) {
            throw new InvalidArgumentException('Pass either tag or digest, not both');
        }
        if ($tag !== null && preg_match(self::TAG_PATTERN, $tag) !== 1) {
            throw new InvalidArgumentException("Invalid image tag \"{$tag}\"");
        }
        if ($digest !== null && preg_match(self::DIGEST_PATTERN, $digest) !== 1) {
            throw new InvalidArgumentException('digest must be sha256:<64 hex characters>');
        }

        $payload = [];
        if ($tag !== null) {
            $payload['tag'] = $tag;
        }
        if ($digest !== null) {
            $payload['digest'] = $digest;
        }

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request(
            'POST',
            $this->basePath($projectId) . "/{$appId}/deployments",
            // The route requires an object body even when empty, and json_encode([])
            // emits "[]" — so an empty stdClass stands in for "{}".
            $payload === [] ? new stdClass() : $payload,
        );
    }

    /**
     * Fetches one deployment's current phase.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function getDeployment(string $appId, string $deploymentId, ?string $projectId = null): array
    {
        self::requireAppId($appId);
        if ($deploymentId === '') {
            throw new InvalidArgumentException('deploymentId is required');
        }

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . "/{$appId}/deployments/{$deploymentId}",
        );
    }

    /**
     * Polls a deployment until it finishes, and returns it in its final phase.
     *
     * Returns for every finished phase, failures included — check `phase` for
     * `ACTIVE`. Throws only when a request fails or `$timeout` passes first, in
     * which case the deployment keeps going server-side.
     *
     * @param float                                       $interval Seconds between polls.
     * @param float                                       $timeout  Seconds to wait in total before giving up.
     * @param (callable(array<string, mixed>): void)|null $onPoll   Called with every poll result, including the last.
     *
     * @return array<string, mixed>
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     * @throws RuntimeException When the deployment has not finished within `$timeout`.
     */
    public function waitForDeployment(
        string $appId,
        string $deploymentId,
        float $interval = self::DEFAULT_POLL_INTERVAL,
        float $timeout = self::DEFAULT_WAIT_TIMEOUT,
        ?callable $onPoll = null,
        ?string $projectId = null,
    ): array {
        if ($interval <= 0) {
            throw new InvalidArgumentException('interval must be greater than 0');
        }
        if ($timeout <= 0) {
            throw new InvalidArgumentException('timeout must be greater than 0');
        }

        $deadline = ($this->clock)() + $timeout;

        while (true) {
            $deployment = $this->getDeployment($appId, $deploymentId, $projectId)['data'];
            if ($onPoll !== null) {
                $onPoll($deployment);
            }
            if (in_array($deployment['phase'] ?? null, self::FINISHED_DEPLOYMENT_PHASES, true)) {
                return $deployment;
            }

            $remaining = $deadline - ($this->clock)();
            if ($remaining <= 0) {
                $phase = is_string($deployment['phase'] ?? null) ? $deployment['phase'] : 'unknown';
                throw new RuntimeException(
                    "Deployment {$deploymentId} was still {$phase} after " . round($timeout) . 's',
                );
            }
            ($this->sleep)(min($interval, $remaining));
        }
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/apps';
    }

    /** Rejects an empty app id before it becomes a malformed route. */
    private static function requireAppId(string $appId): void
    {
        if ($appId === '') {
            throw new InvalidArgumentException('appId is required');
        }
    }
}
