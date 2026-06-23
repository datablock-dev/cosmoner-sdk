<?php

declare(strict_types=1);

namespace Datablock\Sdk\Tests;

use Datablock\Sdk\DatablockError;
use PHPUnit\Framework\TestCase;

class DatablockErrorTest extends TestCase
{
    public function testStoresStatusCodeAndMessage(): void
    {
        $err = new DatablockError(422, 'VALIDATION_ERROR', 'Invalid input');

        $this->assertSame(422, $err->status);
        $this->assertSame('VALIDATION_ERROR', $err->errorCode);
        $this->assertSame('Invalid input', $err->getMessage());
    }

    public function testIsInstanceOfRuntimeException(): void
    {
        $err = new DatablockError(500, 'INTERNAL', 'fail');

        $this->assertInstanceOf(\RuntimeException::class, $err);
    }

    public function testStatusIsUsedAsExceptionCode(): void
    {
        $err = new DatablockError(503, 'UNAVAILABLE', 'Service down');

        $this->assertSame(503, $err->getCode());
    }
}
