<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\WebhookSignature;
use Cosmoner\Sdk\WebhookSignatureError;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class WebhookSignatureTest extends TestCase
{
    private const SECRET = 'whsec_0123456789abcdef';

    private string $body;

    protected function setUp(): void
    {
        $this->body = (string) json_encode([
            'id' => 'dlv_1',
            'type' => 'email.delivered',
            'createdAt' => '2026-08-08T12:00:00.000Z',
            'data' => ['messageId' => 'msg-1'],
        ]);
    }

    /** Build the header the platform would send for a body at a given time. */
    private function sign(string $body, ?string $secret = null, ?int $timestamp = null): string
    {
        $secret ??= self::SECRET;
        $timestamp ??= time();
        $digest = hash_hmac('sha256', $timestamp . '.' . $body, $secret);

        return "t={$timestamp},v1={$digest}";
    }

    public function testAcceptsASignatureFromTheSameSecret(): void
    {
        $this->assertTrue(
            WebhookSignature::verify($this->body, $this->sign($this->body), self::SECRET),
        );
    }

    public function testRejectsABodyModifiedAfterSigning(): void
    {
        $tampered = str_replace('msg-1', 'msg-2', $this->body);

        $this->assertFalse(
            WebhookSignature::verify($tampered, $this->sign($this->body), self::SECRET),
        );
    }

    public function testRejectsASignatureFromAnotherSecret(): void
    {
        $signature = $this->sign($this->body, 'whsec_theirs');

        $this->assertFalse(WebhookSignature::verify($this->body, $signature, self::SECRET));
    }

    public function testRejectsASignatureOlderThanTheTolerance(): void
    {
        $stale = time() - (WebhookSignature::DEFAULT_TOLERANCE_SECONDS + 60);
        $signature = $this->sign($this->body, null, $stale);

        $this->assertFalse(WebhookSignature::verify($this->body, $signature, self::SECRET));
    }

    public function testRejectsATimestampFarInTheFuture(): void
    {
        $future = time() + (WebhookSignature::DEFAULT_TOLERANCE_SECONDS + 60);
        $signature = $this->sign($this->body, null, $future);

        $this->assertFalse(WebhookSignature::verify($this->body, $signature, self::SECRET));
    }

    public function testAcceptsAStaleSignatureWhenTheAgeCheckIsDisabled(): void
    {
        $stale = time() - 86400;
        $signature = $this->sign($this->body, null, $stale);

        $this->assertTrue(WebhookSignature::verify($this->body, $signature, self::SECRET, 0));
    }

    public function testHonoursACustomTolerance(): void
    {
        $signature = $this->sign($this->body, null, time() - 100);

        $this->assertFalse(WebhookSignature::verify($this->body, $signature, self::SECRET, 60));
        $this->assertTrue(WebhookSignature::verify($this->body, $signature, self::SECRET, 300));
    }

    /**
     * @return array<string, array{string}>
     */
    public static function malformedHeaderProvider(): array
    {
        return [
            'empty' => [''],
            'missing v1' => ['t=1754654400'],
            'missing timestamp' => ['v1=abc123'],
            'non-numeric timestamp' => ['t=not-a-number,v1=abc123'],
            'unstructured' => ['just-a-digest'],
        ];
    }

    #[DataProvider('malformedHeaderProvider')]
    public function testRejectsMalformedHeaders(string $signature): void
    {
        $this->assertFalse(WebhookSignature::verify($this->body, $signature, self::SECRET));
    }

    public function testRejectsADigestOfTheWrongLength(): void
    {
        $signature = 't=' . time() . ',v1=deadbeef';

        $this->assertFalse(WebhookSignature::verify($this->body, $signature, self::SECRET));
    }

    public function testRejectsAnEmptySecret(): void
    {
        $this->assertFalse(WebhookSignature::verify($this->body, $this->sign($this->body), ''));
    }

    public function testAcceptsASignatureExactlyAtTheToleranceBoundary(): void
    {
        $boundary = time() - WebhookSignature::DEFAULT_TOLERANCE_SECONDS;
        $signature = $this->sign($this->body, null, $boundary);

        $this->assertTrue(WebhookSignature::verify($this->body, $signature, self::SECRET));
    }

    public function testConstructEventReturnsTheParsedEnvelope(): void
    {
        $event = WebhookSignature::constructEvent(
            $this->body,
            $this->sign($this->body),
            self::SECRET,
        );

        $this->assertSame('dlv_1', $event['id']);
        $this->assertSame('email.delivered', $event['type']);
        $this->assertSame(['messageId' => 'msg-1'], $event['data']);
    }

    public function testConstructEventThrowsWhenTheSignatureDoesNotMatch(): void
    {
        $this->expectException(WebhookSignatureError::class);

        WebhookSignature::constructEvent(
            $this->body,
            $this->sign('something else'),
            self::SECRET,
        );
    }

    public function testConstructEventNamesTheHeaderWhenItIsMissing(): void
    {
        $this->expectException(WebhookSignatureError::class);
        $this->expectExceptionMessage(WebhookSignature::SIGNATURE_HEADER);

        WebhookSignature::constructEvent($this->body, '', self::SECRET);
    }

    public function testConstructEventDistinguishesAMalformedHeader(): void
    {
        $this->expectException(WebhookSignatureError::class);
        $this->expectExceptionMessage('Malformed');

        WebhookSignature::constructEvent($this->body, 'garbage', self::SECRET);
    }

    public function testConstructEventThrowsWhenTheSecretIsMissing(): void
    {
        $this->expectException(WebhookSignatureError::class);
        $this->expectExceptionMessage('Signing secret is required');

        WebhookSignature::constructEvent($this->body, $this->sign($this->body), '');
    }

    public function testConstructEventThrowsWhenASignedBodyIsNotJson(): void
    {
        $notJson = 'this is signed but not json';

        $this->expectException(WebhookSignatureError::class);
        $this->expectExceptionMessage('not valid JSON');

        WebhookSignature::constructEvent($notJson, $this->sign($notJson), self::SECRET);
    }

    public function testConstructEventCarriesTheSdkErrorCode(): void
    {
        try {
            WebhookSignature::constructEvent($this->body, 'garbage', self::SECRET);
            $this->fail('Expected WebhookSignatureError');
        } catch (WebhookSignatureError $e) {
            $this->assertSame('WEBHOOK_SIGNATURE_INVALID', $e->errorCode);
        }
    }
}
