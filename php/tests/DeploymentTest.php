<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Deployment;
use Cosmoner\Sdk\DeploymentIssue;
use PHPUnit\Framework\TestCase;

/**
 * Behaviour of the deployment validator that the shared fixtures do not pin.
 */
final class DeploymentTest extends TestCase
{
    public function testAppliesTheDefaultsThePlatformApplies(): void
    {
        $result = Deployment::validate("services:\n  - name: web\n");

        self::assertSame(
            ['version' => 1, 'services' => [['name' => 'web', 'type' => 'service']]],
            $result->template
        );
    }

    public function testDropsUnknownKeysAsThePlatformDoes(): void
    {
        // The warning says the field is ignored; the template has to show it
        // being ignored, or the two halves of the answer disagree.
        $result = Deployment::validate("services:\n  - name: web\n    replicas: 3\n");

        self::assertNotNull($result->template);
        $services = $result->template['services'];
        self::assertIsArray($services);
        self::assertSame(['name' => 'web', 'type' => 'service'], $services[0]);
        self::assertCount(1, $result->warnings());
        self::assertSame([], $result->errors());
    }

    public function testWarningsAloneLeaveAFileValid(): void
    {
        $result = Deployment::validate("services:\n  - name: web\n    prot: 3000\n");

        self::assertTrue($result->valid);
    }

    public function testStrictFailsTheSameFile(): void
    {
        $result = Deployment::validate("services:\n  - name: web\n    prot: 3000\n", true);

        self::assertFalse($result->valid);
        // strict changes the verdict, not the finding — the field is still only
        // a warning as far as the platform is concerned.
        self::assertCount(1, $result->warnings());
        self::assertNotNull($result->template);
    }

    public function testRefusesAFilePastTheSizeLimit(): void
    {
        $result = Deployment::validate(str_repeat('#', Deployment::MAX_BYTES + 1));

        self::assertFalse($result->valid);
        self::assertSame('File exceeds the 64 KiB limit', $result->issues[0]->message);
    }

    public function testMeasuresTheLimitInBytesNotCharacters(): void
    {
        // A file of multi-byte characters is over the limit well before it is
        // MAX_BYTES characters long.
        $result = Deployment::validate(str_repeat('é', Deployment::MAX_BYTES - 10));

        self::assertStringContainsString('exceeds', $result->issues[0]->message);
    }

    public function testReportsTheParsersOwnMessageForASyntaxError(): void
    {
        $result = Deployment::validate("services: [{name: web}\n");

        self::assertSame('(root)', $result->issues[0]->path);
        self::assertStringStartsWith('Invalid YAML: ', $result->issues[0]->message);
    }

    public function testChecksADocumentThatNeverWasAFile(): void
    {
        $result = Deployment::validateDocument([
            'services' => [['name' => 'web', 'type' => 'static', 'run_command' => 'npm start']],
        ]);

        self::assertFalse($result->valid);
        self::assertSame(
            ['services.0.run_command'],
            array_map(static fn(DeploymentIssue $i) => $i->path, $result->issues)
        );
    }

    public function testTreatsAnAbsentDocumentAsAnEmptyFile(): void
    {
        self::assertSame('File is empty', Deployment::validateDocument(null)->issues[0]->message);
    }

    public function testFilePathsPutTheDocumentedLocationFirst(): void
    {
        // The platform reads the first of these that exists, so the order is
        // part of the contract, not a list of equivalents.
        self::assertSame('.cosmoner/deployment.yaml', Deployment::FILE_PATHS[0]);
        self::assertSame('.datablock/app.yml', Deployment::FILE_PATHS[count(Deployment::FILE_PATHS) - 1]);
    }
}
