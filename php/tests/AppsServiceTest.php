<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\AppsService;
use Cosmoner\Sdk\Config;
use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\CosmonerConnectionError;
use Cosmoner\Sdk\HttpResponse;
use Cosmoner\Sdk\NotFoundError;
use Cosmoner\Sdk\Transport;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;
use RuntimeException;

class AppsServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/apps';
    private const DIGEST = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    private Cosmoner $client;
    private FakeHttpClient $http;

    /** Seconds the fake clock has advanced, moved only by the fake sleep. */
    private float $now = 0.0;

    /** @var list<float> */
    private array $sleeps = [];

    protected function setUp(): void
    {
        $this->http = new FakeHttpClient();
        $this->client = new Cosmoner(
            'key-123',
            'proj-1',
            'https://api.test.dev',
            30.0,
            0,
            $this->http,
        );
    }

    /** Build a service whose sleep advances a fake clock instead of waiting. */
    private function pollingService(): AppsService
    {
        $config = new Config('key-123', 'proj-1', 'https://api.test.dev', 30.0, 0);

        return new AppsService(
            new Transport($config, $this->http),
            $config,
            function (float $seconds): void {
                $this->sleeps[] = $seconds;
                $this->now += $seconds;
            },
            fn (): float => $this->now,
        );
    }

    /**
     * Decode the JSON body of the recorded request.
     *
     * @return array<string, mixed>
     */
    private function sentBody(): array
    {
        return json_decode((string) $this->http->requests[0]['body'], true);
    }

    /** @return array<string, mixed> */
    private function appFixture(): array
    {
        return [
            'id' => 'app-1',
            'name' => 'web',
            'subdomain' => 'web',
            'status' => 'RUNNING',
            'url' => 'https://web.cosmoner.app',
            'gitRepo' => null,
            'containerImage' => 'registry.cosmoner.com/acme/web:v1',
            'imageDeployPolicy' => 'MANUAL',
            'createdAt' => '2026-09-01T12:00:00.000Z',
            'updatedAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    /** @return array<string, mixed> */
    private function deploymentFixture(string $phase = 'PENDING'): array
    {
        return [
            'id' => 'dep-1',
            'phase' => $phase,
            'cause' => 'api deploy',
            'imageRef' => 'registry.cosmoner.com/acme/web:v2',
            'imageDigest' => null,
            'error' => null,
            'startedAt' => '2026-09-16T12:00:00.000Z',
            'finishedAt' => null,
        ];
    }

    /** Queue one deployment response per phase, in order. */
    private function queuePhases(string ...$phases): void
    {
        foreach ($phases as $phase) {
            $this->http->queueJson(200, ['success' => true, 'data' => $this->deploymentFixture($phase)]);
        }
    }

    public function testThrowsWhenAppIdIsEmptyOnDeploy(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('appId is required');

        $this->client->apps->deploy('');
    }

    public function testThrowsWhenBothTagAndDigestAreGiven(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Pass either tag or digest, not both');

        $this->client->apps->deploy('app-1', 'v2', self::DIGEST);
    }

    public function testThrowsOnAMalformedTag(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid image tag ".v2"');

        $this->client->apps->deploy('app-1', '.v2');
    }

    public function testThrowsOnAMalformedDigest(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('digest must be sha256:<64 hex characters>');

        $this->client->apps->deploy('app-1', digest: 'sha256:ABC');
    }

    public function testRejectsInvalidInputWithoutSendingARequest(): void
    {
        try {
            $this->client->apps->deploy('app-1', str_repeat('a', 129));
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException) {
            $this->assertSame(0, $this->http->callCount());
        }
    }

    public function testThrowsWhenDeploymentIdIsEmpty(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('deploymentId is required');

        $this->client->apps->getDeployment('app-1', '');
    }

    public function testThrowsWhenNoProjectIdIsAvailable(): void
    {
        $scopeless = new Cosmoner('key-123', null, 'https://api.test.dev', 30.0, 0, $this->http);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('projectId is required');

        $scopeless->apps->list();
    }

    public function testListsApps(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->appFixture()]]);

        $result = $this->client->apps->list();

        $this->assertSame([$this->appFixture()], $result['data']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
    }

    public function testThrowsWhenAppIdIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('appId is required');

        $this->client->apps->get('');
    }

    public function testThrowsWhenAppIdIsEmptyOnLogs(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('appId is required');

        $this->client->apps->logs('', 'RUN');
    }

    public function testRejectsAnUnknownLogTypeWithoutSendingARequest(): void
    {
        foreach (['', 'run', 'DEPLOY'] as $type) {
            try {
                $this->client->apps->logs('app-1', $type);
                $this->fail("Expected an InvalidArgumentException for \"{$type}\"");
            } catch (InvalidArgumentException $err) {
                $this->assertSame('type must be "BUILD" or "RUN"', $err->getMessage());
            }
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testFetchesAnApp(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->appFixture()]);

        $result = $this->client->apps->get('app-1');

        $this->assertSame(['success' => true, 'data' => $this->appFixture()], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/app-1', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testFetchesBuildLogs(): void
    {
        $lines = [['message' => 'Step 1/4', 'timestamp' => '2026-09-01T12:00:00.000Z']];
        $this->http->queueJson(200, ['success' => true, 'data' => ['lines' => $lines]]);

        $result = $this->client->apps->logs('app-1', 'BUILD');

        $this->assertSame($lines, $result['data']['lines']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/app-1/logs?type=BUILD', $this->http->requests[0]['url']);
    }

    public function testFetchesRuntimeLogsFromAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['lines' => []]]);

        $this->client->apps->logs('app-1', 'RUN', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/apps/app-1/logs?type=RUN',
            $this->http->requests[0]['url'],
        );
    }

    public function testDeploysATag(): void
    {
        $this->http->queueJson(202, ['success' => true, 'data' => $this->deploymentFixture()]);

        $result = $this->client->apps->deploy('app-1', 'v2');

        $this->assertSame('dep-1', $result['data']['id']);
        $this->assertSame('POST', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/app-1/deployments', $this->http->requests[0]['url']);
        $this->assertSame(['tag' => 'v2'], $this->sentBody());
    }

    public function testDeploysADigest(): void
    {
        $this->http->queueJson(202, ['success' => true, 'data' => $this->deploymentFixture()]);

        $this->client->apps->deploy('app-1', digest: self::DIGEST);

        $this->assertSame(['digest' => self::DIGEST], $this->sentBody());
    }

    public function testSendsAnEmptyObjectWhenNeitherTagNorDigestIsGiven(): void
    {
        $this->http->queueJson(202, ['success' => true, 'data' => $this->deploymentFixture()]);

        $this->client->apps->deploy('app-1');

        // The route requires an object body; "[]" or no body would be rejected.
        $this->assertSame('{}', $this->http->requests[0]['body']);
    }

    public function testFetchesADeployment(): void
    {
        $this->queuePhases('BUILDING');

        $result = $this->client->apps->getDeployment('app-1', 'dep-1');

        $this->assertSame('BUILDING', $result['data']['phase']);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/app-1/deployments/dep-1', $this->http->requests[0]['url']);
    }

    public function testTargetsAnotherProjectPerCall(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->apps->list('proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/apps',
            $this->http->requests[0]['url'],
        );
    }

    public function testMapsA404OntoNotFoundError(): void
    {
        $this->http->queueJson(404, [
            'success' => false,
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Deployment not found'],
        ]);

        $this->expectException(NotFoundError::class);

        $this->client->apps->getDeployment('app-1', 'dep-missing');
    }

    public function testSendsAuthAndIdempotencyHeadersOnDeploy(): void
    {
        $this->http->queueJson(202, ['success' => true, 'data' => $this->deploymentFixture()]);

        $this->client->apps->deploy('app-1', 'v2');

        $headers = $this->http->requests[0]['headers'];
        $this->assertSame('Bearer key-123', $headers['Authorization']);
        $this->assertNotEmpty($headers['Idempotency-Key']);
    }

    public function testWaitsUntilTheDeploymentIsActive(): void
    {
        $this->queuePhases('PENDING', 'DEPLOYING', 'ACTIVE');
        $polled = [];

        $result = $this->pollingService()->waitForDeployment(
            'app-1',
            'dep-1',
            interval: 2.0,
            onPoll: function (array $deployment) use (&$polled): void {
                $polled[] = $deployment['phase'];
            },
        );

        $this->assertSame('ACTIVE', $result['phase']);
        $this->assertSame(['PENDING', 'DEPLOYING', 'ACTIVE'], $polled);
        $this->assertSame([2.0, 2.0], $this->sleeps);
    }

    public function testReturnsAFailedDeploymentRatherThanThrowing(): void
    {
        $this->queuePhases('BUILDING', 'ERROR');

        $result = $this->pollingService()->waitForDeployment('app-1', 'dep-1');

        $this->assertSame('ERROR', $result['phase']);
        $this->assertSame(2, $this->http->callCount());
    }

    public function testThrowsWhenTheTimeoutPassesFirst(): void
    {
        $this->queuePhases('DEPLOYING');

        try {
            $this->pollingService()->waitForDeployment('app-1', 'dep-1', interval: 4.0, timeout: 10.0);
            $this->fail('Expected a RuntimeException');
        } catch (RuntimeException $e) {
            $this->assertSame('Deployment dep-1 was still DEPLOYING after 10s', $e->getMessage());
        }

        // The last sleep is clamped to what remains of the timeout.
        $this->assertSame([4.0, 4.0, 2.0], $this->sleeps);
        $this->assertSame(4, $this->http->callCount());
    }

    public function testPropagatesARequestFailureWhileWaiting(): void
    {
        $this->queuePhases('PENDING');
        $this->http->queue(new CosmonerConnectionError('connection reset'));

        $this->expectException(CosmonerConnectionError::class);

        $this->pollingService()->waitForDeployment('app-1', 'dep-1');
    }

    public function testThrowsWhenTheIntervalIsNotPositive(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('interval must be greater than 0');

        $this->client->apps->waitForDeployment('app-1', 'dep-1', interval: 0.0);
    }

    public function testThrowsWhenTheTimeoutIsNotPositive(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('timeout must be greater than 0');

        $this->client->apps->waitForDeployment('app-1', 'dep-1', timeout: 0.0);
    }

    public function testThrowsWhenAppIdIsEmptyOnUpdate(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('appId is required');

        $this->client->apps->update('', ['name' => 'web']);
    }

    public function testRejectsAnUpdateWithNoChangesWithoutSendingARequest(): void
    {
        try {
            $this->client->apps->update('app-1', []);
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('at least one change is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testRejectsAnUnknownChangeWithoutSendingARequest(): void
    {
        try {
            $this->client->apps->update('app-1', ['build_command' => 'npm run build']);
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('Unknown change "build_command"', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testUpdatesOnlyTheGivenSettings(): void
    {
        $updated = [...$this->appFixture(), 'imageDeployPolicy' => 'NEWEST'];
        $this->http->queueJson(200, ['success' => true, 'data' => $updated]);

        $result = $this->client->apps->update('app-1', [
            'buildCommand' => 'npm run build',
            'publicPort' => 8080,
            'autoDeploy' => false,
            'imageDeployPolicy' => 'NEWEST',
            'instances' => 2,
        ]);

        $this->assertSame(['success' => true, 'data' => $updated], $result);
        $this->assertSame('PATCH', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/app-1', $this->http->requests[0]['url']);
        $this->assertSame(
            '{"buildCommand":"npm run build","publicPort":8080,"autoDeploy":false,'
            . '"imageDeployPolicy":"NEWEST","instances":2}',
            $this->http->requests[0]['body'],
        );
    }

    public function testSendsAnExplicitNullToClearASetting(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->appFixture()]);

        $this->client->apps->update('app-1', ['outputDir' => null, 'internalPort' => null]);

        $this->assertSame('{"outputDir":null,"internalPort":null}', $this->http->requests[0]['body']);
    }

    public function testUpdatesAnAppInAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->appFixture()]);

        $this->client->apps->update('app-1', ['name' => 'web'], 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/apps/app-1', $this->http->requests[0]['url']);
        $this->assertSame(['name' => 'web'], $this->sentBody());
    }

    public function testThrowsWhenAppIdIsEmptyOnDelete(): void
    {
        try {
            $this->client->apps->delete('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('appId is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testDeletesAnApp(): void
    {
        $this->http->queue(new HttpResponse(200, '{"success":true,"data":{}}'));

        $result = $this->client->apps->delete('app-1');

        $this->assertSame(['success' => true, 'data' => []], $result);
        $this->assertSame('DELETE', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/app-1', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testDeletesAnAppInAnotherProject(): void
    {
        $this->http->queue(new HttpResponse(200, '{"success":true,"data":{}}'));

        $this->client->apps->delete('app-1', 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/apps/app-1', $this->http->requests[0]['url']);
    }

    /** @return array<string, mixed> */
    private function previewFixture(): array
    {
        return [
            'subtotal' => 500,
            'tax' => null,
            'creditApplied' => 0,
            'dueToday' => 500,
            'monthly' => 500,
            'currency' => 'USD',
            'nextBillingDate' => '2026-11-01T00:00:00.000Z',
        ];
    }

    public function testPreviewsASize(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->previewFixture()]);

        $result = $this->client->apps->preview('basic-xxs');

        $this->assertSame(['success' => true, 'data' => $this->previewFixture()], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/preview?size=basic-xxs', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testPreviewsASizeInAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->previewFixture()]);

        $this->client->apps->preview('basic-xxs', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/apps/preview?size=basic-xxs',
            $this->http->requests[0]['url'],
        );
    }

    public function testRejectsAPreviewWithoutASizeWithoutSendingARequest(): void
    {
        try {
            $this->client->apps->preview('');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('size is required', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testCreatesADraftWithOnlyTheRequiredFieldsOnACosmonerDomain(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['draftId' => 'draft-1']]);

        $result = $this->client->apps->createDraft(['size' => 'basic-xxs', 'region' => 'fra']);

        $this->assertSame(['success' => true, 'data' => ['draftId' => 'draft-1']], $result);
        $this->assertSame('POST', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/draft', $this->http->requests[0]['url']);
        $this->assertSame(
            '{"size":"basic-xxs","region":"fra","domainType":"cosmoner"}',
            $this->http->requests[0]['body'],
        );
    }

    public function testPassesThroughTheGivenDraftFields(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['draftId' => 'draft-1']]);

        $this->client->apps->createDraft([
            'name' => 'web',
            'size' => 'basic-xxs',
            'region' => 'fra',
            'appType' => 'service',
            'gitProvider' => 'github',
            'gitRepo' => 'acme/web',
            'gitBranch' => 'main',
            'sourceDir' => '/',
            'buildStrategy' => 'nixpacks',
            'buildCommand' => 'npm run build',
            'runCommand' => 'npm start',
            'outputDir' => null,
            'publicPort' => 3000,
            'internalPort' => 3001,
            'autoDeploy' => false,
            'instances' => 2,
        ]);

        $this->assertSame(
            [
                'name' => 'web',
                'size' => 'basic-xxs',
                'region' => 'fra',
                'appType' => 'service',
                'gitProvider' => 'github',
                'gitRepo' => 'acme/web',
                'gitBranch' => 'main',
                'sourceDir' => '/',
                'buildStrategy' => 'nixpacks',
                'buildCommand' => 'npm run build',
                'runCommand' => 'npm start',
                'publicPort' => 3000,
                'internalPort' => 3001,
                'autoDeploy' => false,
                'instances' => 2,
                'domainType' => 'cosmoner',
            ],
            $this->sentBody(),
        );
    }

    public function testCreatesAnImageDraftInAnotherProject(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['draftId' => 'draft-1']]);

        $this->client->apps->createDraft([
            'size' => 'basic-xxs',
            'region' => 'fra',
            'containerRegistry' => 'cosmoner',
            'containerImage' => 'registry.cosmoner.com/acme/web:v1',
            'containerPublicPort' => '8080',
            'imageDeployPolicy' => 'NEWEST',
        ], 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/apps/draft', $this->http->requests[0]['url']);
        $this->assertSame(
            [
                'size' => 'basic-xxs',
                'region' => 'fra',
                'containerRegistry' => 'cosmoner',
                'containerImage' => 'registry.cosmoner.com/acme/web:v1',
                'containerPublicPort' => '8080',
                'imageDeployPolicy' => 'NEWEST',
                'domainType' => 'cosmoner',
            ],
            $this->sentBody(),
        );
    }

    public function testRejectsADraftMissingARequiredFieldWithoutSendingARequest(): void
    {
        $valid = ['size' => 'basic-xxs', 'region' => 'fra'];

        foreach (['size', 'region'] as $field) {
            try {
                $this->client->apps->createDraft([...$valid, $field => '']);
                $this->fail("Expected an InvalidArgumentException for an empty {$field}");
            } catch (InvalidArgumentException $err) {
                $this->assertSame("{$field} is required", $err->getMessage());
            }
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testRejectsADraftThatSetsItsOwnDomainTypeWithoutSendingARequest(): void
    {
        try {
            $this->client->apps->createDraft(['size' => 'basic-xxs', 'region' => 'fra', 'domainType' => 'searched']);
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('Unknown field "domainType"', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testCreatesAnAppFromADraft(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true, 'appId' => 'app-1']]);

        $result = $this->client->apps->create(['draftId' => 'draft-1', 'size' => 'basic-xxs']);

        $this->assertSame(['success' => true, 'data' => ['deployed' => true, 'appId' => 'app-1']], $result);
        $this->assertSame('POST', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
        $this->assertSame('{"draftId":"draft-1","size":"basic-xxs"}', $this->http->requests[0]['body']);
    }

    public function testCreatesAnAppInAnotherProject(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => ['deployed' => true, 'appId' => 'app-1']]);

        $this->client->apps->create(['draftId' => 'draft-1', 'size' => 'basic-xxs'], 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/apps', $this->http->requests[0]['url']);
    }

    public function testRejectsACreateMissingARequiredFieldWithoutSendingARequest(): void
    {
        $valid = ['draftId' => 'draft-1', 'size' => 'basic-xxs'];

        foreach (['draftId', 'size'] as $field) {
            try {
                $this->client->apps->create([...$valid, $field => '']);
                $this->fail("Expected an InvalidArgumentException for an empty {$field}");
            } catch (InvalidArgumentException $err) {
                $this->assertSame("{$field} is required", $err->getMessage());
            }
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testListsTheSizesAnAppCanMoveTo(): void
    {
        $options = [
            'currentSize' => 'basic-xxs',
            'resizable' => true,
            'sizes' => [[
                'slug' => 'basic-xs',
                'name' => 'Basic XS',
                'tierSlug' => 'basic',
                'cpuType' => 'shared',
                'cpus' => 1,
                'memoryMb' => 1024,
                'bandwidthGib' => 100,
                'priceMonthly' => 10,
            ]],
        ];
        $this->http->queueJson(200, ['success' => true, 'data' => $options]);

        $result = $this->client->apps->sizes('app-1');

        $this->assertSame(['success' => true, 'data' => $options], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/app-1/sizes', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testListsSizesInAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['currentSize' => null, 'resizable' => false]]);

        $this->client->apps->sizes('app-1', 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/apps/app-1/sizes', $this->http->requests[0]['url']);
    }

    public function testPreviewsAResize(): void
    {
        $preview = [
            ...$this->previewFixture(),
            'direction' => 'upgrade',
            'creditBack' => 0,
            'currentMonthly' => 500,
            'monthly' => 1000,
        ];
        $this->http->queueJson(200, ['success' => true, 'data' => $preview]);

        $result = $this->client->apps->resizePreview('app-1', 'basic-xs');

        $this->assertSame(['success' => true, 'data' => $preview], $result);
        $this->assertSame('GET', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/app-1/resize-preview?size=basic-xs', $this->http->requests[0]['url']);
        $this->assertNull($this->http->requests[0]['body']);
    }

    public function testPreviewsAResizeInAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->previewFixture()]);

        $this->client->apps->resizePreview('app-1', 'basic-xs', 'proj-2');

        $this->assertSame(
            'https://api.test.dev/v1/projects/proj-2/apps/app-1/resize-preview?size=basic-xs',
            $this->http->requests[0]['url'],
        );
    }

    public function testResizesAnApp(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['instanceSize' => 'basic-xs']]);

        $result = $this->client->apps->resize('app-1', 'basic-xs');

        $this->assertSame(['success' => true, 'data' => ['instanceSize' => 'basic-xs']], $result);
        $this->assertSame('PATCH', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/app-1/size', $this->http->requests[0]['url']);
        $this->assertSame('{"size":"basic-xs"}', $this->http->requests[0]['body']);
    }

    public function testResizesAnAppInAnotherProject(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => ['instanceSize' => 'basic-xs']]);

        $this->client->apps->resize('app-1', 'basic-xs', 'proj-2');

        $this->assertSame('https://api.test.dev/v1/projects/proj-2/apps/app-1/size', $this->http->requests[0]['url']);
    }

    public function testRejectsAnEmptyAppIdOrSizeOnResizeWithoutSendingARequest(): void
    {
        $calls = [
            'appId is required' => [
                fn () => $this->client->apps->sizes(''),
                fn () => $this->client->apps->resizePreview('', 'basic-xs'),
                fn () => $this->client->apps->resize('', 'basic-xs'),
            ],
            'size is required' => [
                fn () => $this->client->apps->resizePreview('app-1', ''),
                fn () => $this->client->apps->resize('app-1', ''),
            ],
        ];

        foreach ($calls as $message => $attempts) {
            foreach ($attempts as $attempt) {
                try {
                    $attempt();
                    $this->fail("Expected an InvalidArgumentException: {$message}");
                } catch (InvalidArgumentException $err) {
                    $this->assertSame($message, $err->getMessage());
                }
            }
        }

        $this->assertSame(0, $this->http->callCount());
    }
}
