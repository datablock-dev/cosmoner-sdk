<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/** Default `HttpClient`, backed by ext-curl. */
final class CurlHttpClient implements HttpClient
{
    /**
     * Sends one request via curl, translating transport failures into
     * `CosmonerConnectionError` (or `CosmonerTimeoutError` for timeouts).
     *
     * @param array<string, string> $headers
     */
    public function send(
        string $method,
        string $url,
        array $headers,
        ?string $body,
        float $timeout,
    ): HttpResponse {
        $responseHeaders = [];

        $formatted = [];
        foreach ($headers as $name => $value) {
            $formatted[] = "{$name}: {$value}";
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $formatted,
            CURLOPT_TIMEOUT_MS => (int) round($timeout * 1000),
            CURLOPT_HEADERFUNCTION => function ($_ch, string $line) use (&$responseHeaders): int {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }

                return strlen($line);
            },
        ]);

        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }

        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        unset($ch); // curl_close() is a no-op on PHP 8+; the handle frees itself.

        if ($response === false) {
            if ($errno === CURLE_OPERATION_TIMEDOUT) {
                throw new CosmonerTimeoutError("Request timed out: {$error}");
            }

            throw new CosmonerConnectionError("Request failed: {$error}");
        }

        return new HttpResponse($status, (string) $response, $responseHeaders);
    }
}
