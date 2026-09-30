<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Cosmoner;
use Cosmoner\Sdk\HttpResponse;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class VariablesServiceTest extends TestCase
{
    private const BASE = 'https://api.test.dev/v1/projects/proj-1/variables';

    private Cosmoner $client;
    private FakeHttpClient $http;

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

    /** @return array<string, mixed> */
    private function variableFixture(): array
    {
        $actor = ['id' => 'user-1', 'name' => 'Ada', 'email' => 'ada@example.com'];

        return [
            'id' => 'var-1',
            'name' => 'LOG_LEVEL',
            'description' => 'Verbosity',
            'value' => 'debug',
            'environment' => 'development',
            'createdBy' => 'user-1',
            'updatedBy' => 'user-1',
            'createdByUser' => $actor,
            'updatedByUser' => $actor,
            'createdAt' => '2026-09-01T12:00:00.000Z',
            'updatedAt' => '2026-09-01T12:00:00.000Z',
        ];
    }

    /** @return array<string, mixed> */
    private function decodedBody(int $index = 0): array
    {
        /** @var array<string, mixed> */
        return (array) json_decode((string) $this->http->requests[$index]['body'], true);
    }

    public function testThrowsWhenVariableIdIsEmptyOnGet(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('variableId is required');
        $this->client->variables->get('');
    }

    public function testRejectsAnUpdateThatChangesNothing(): void
    {
        try {
            $this->client->variables->update('var-1');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertSame('Provide a value or description to update', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testRejectsALowercaseNameWithoutSendingARequest(): void
    {
        try {
            $this->client->variables->create('log_level', 'debug');
            $this->fail('Expected an InvalidArgumentException');
        } catch (InvalidArgumentException $err) {
            $this->assertStringContainsString('uppercase letters', $err->getMessage());
        }

        $this->assertSame(0, $this->http->callCount());
    }

    public function testListsVariablesWithTheirValues(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => [$this->variableFixture()]]);

        $result = $this->client->variables->list();

        $this->assertSame('debug', $result['data'][0]['value']);
        $this->assertSame(self::BASE, $this->http->requests[0]['url']);
    }

    public function testScopesAListToOneEnvironment(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => []]);

        $this->client->variables->list('production');

        $this->assertSame(self::BASE . '?environment=production', $this->http->requests[0]['url']);
    }

    public function testCreatesAVariable(): void
    {
        $this->http->queueJson(201, ['success' => true, 'data' => $this->variableFixture()]);

        $result = $this->client->variables->create('LOG_LEVEL', 'debug');

        $this->assertSame('LOG_LEVEL', $result['data']['name']);
        $this->assertSame(['name' => 'LOG_LEVEL', 'value' => 'debug'], $this->decodedBody());
    }

    public function testUpdatesADescriptionOnItsOwn(): void
    {
        $this->http->queueJson(200, ['success' => true, 'data' => $this->variableFixture()]);

        $this->client->variables->update('var-1', null, 'How loud');

        $this->assertSame('PATCH', $this->http->requests[0]['method']);
        $this->assertSame(['description' => 'How loud'], $this->decodedBody());
    }

    public function testDeletesAVariableToleratingTheEmpty204(): void
    {
        $this->http->queue(new HttpResponse(204, ''));

        $this->client->variables->delete('var-1');

        $this->assertSame('DELETE', $this->http->requests[0]['method']);
        $this->assertSame(self::BASE . '/var-1', $this->http->requests[0]['url']);
    }
}
