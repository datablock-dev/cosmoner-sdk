<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\CosmonerError;
use PHPUnit\Framework\TestCase;

class CosmonerErrorTest extends TestCase
{
    public function testStoresStatusCodeAndMessage(): void
    {
        $err = new CosmonerError(422, 'VALIDATION_ERROR', 'Invalid input');

        $this->assertSame(422, $err->status);
        $this->assertSame('VALIDATION_ERROR', $err->errorCode);
        $this->assertSame('Invalid input', $err->getMessage());
    }

    public function testIsInstanceOfRuntimeException(): void
    {
        $err = new CosmonerError(500, 'INTERNAL', 'fail');

        $this->assertInstanceOf(\RuntimeException::class, $err);
    }

    public function testStatusIsUsedAsExceptionCode(): void
    {
        $err = new CosmonerError(503, 'UNAVAILABLE', 'Service down');

        $this->assertSame(503, $err->getCode());
    }
}
