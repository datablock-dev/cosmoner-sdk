<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Retry;
use PHPUnit\Framework\TestCase;

class RetryTest extends TestCase
{
    public function testRetries429EvenForWrites(): void
    {
        $this->assertTrue((new Retry(2))->shouldRetry(0, 'POST', 429));
    }

    public function testDoesNotRetry5xxForWritesByDefault(): void
    {
        $this->assertFalse((new Retry(2))->shouldRetry(0, 'POST', 500));
    }

    public function testRetries5xxForIdempotentMethods(): void
    {
        $this->assertTrue((new Retry(2))->shouldRetry(0, 'GET', 500));
    }

    public function testRetriesWritesWhenCallerOptsIn(): void
    {
        $this->assertTrue((new Retry(2))->shouldRetry(0, 'POST', 500, true));
    }

    public function testDoesNotRetryTransportFailureForWrites(): void
    {
        $this->assertFalse((new Retry(2))->shouldRetry(0, 'POST', null));
    }

    public function testDoesNotRetryClientErrors(): void
    {
        $this->assertFalse((new Retry(2))->shouldRetry(0, 'GET', 404));
    }

    public function testStopsAtMaxRetries(): void
    {
        $this->assertFalse((new Retry(1))->shouldRetry(1, 'GET', 429));
    }

    public function testIsDisabledWhenMaxRetriesIsZero(): void
    {
        $this->assertFalse((new Retry(0))->shouldRetry(0, 'GET', 429));
    }

    public function testBackoffPrefersRetryAfter(): void
    {
        $this->assertSame(3.0, (new Retry(2))->backoffSeconds(0, 3.0));
    }

    public function testBackoffIsCapped(): void
    {
        $this->assertSame(8.0, (new Retry(2))->backoffSeconds(0, 999.0));
    }

    public function testBackoffIsJitteredWithinCeiling(): void
    {
        $delay = (new Retry(5))->backoffSeconds(2);

        $this->assertGreaterThanOrEqual(0, $delay);
        $this->assertLessThanOrEqual(2.0, $delay);
    }

    public function testParsesRetryAfterInSeconds(): void
    {
        $this->assertSame(5.0, Retry::parseRetryAfter(['retry-after' => '5']));
    }

    public function testIgnoresUnparseableRetryAfter(): void
    {
        $headers = ['retry-after' => 'Wed, 21 Oct 2015 07:28:00 GMT'];

        $this->assertNull(Retry::parseRetryAfter($headers));
    }

    public function testReturnsNullWhenRetryAfterIsAbsent(): void
    {
        $this->assertNull(Retry::parseRetryAfter([]));
    }
}
