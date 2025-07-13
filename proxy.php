<?php
header('Access-Control-Allow-Origin: *');

$symbol   = preg_replace('/[^a-z0-9\\.]/i', '', $_GET['symbol'] ?? '');
$interval = 'd';                     // daily bars

if (!$symbol) {
    http_response_code(400);
    exit('Missing or bad symbol');
}

// Create cache directory if it doesn't exist
$cacheDir = __DIR__ . '/cache';
if (!file_exists($cacheDir)) {
    mkdir($cacheDir, 0755, true);
}

// Cache file path
$cacheFile = $cacheDir . '/' . $symbol . '_' . $interval . '.csv';
$cacheExpiry = 24 * 60 * 60; // 24 hours in seconds

// Check if we have a valid cache file
if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $cacheExpiry)) {
    // Serve from cache
    header('Content-Type: text/csv');
    header('X-Source: cache');
    readfile($cacheFile);
    exit;
}

// Add delay to avoid hitting rate limits
sleep(1);

$url = "https://stooq.com/q/d/l/?s={$symbol}&i={$interval}";

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_CONNECTTIMEOUT => 4,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
]);
$data = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($code !== 200 || $data === false) {
    // If we have an old cache, use it even if expired
    if (file_exists($cacheFile)) {
        header('Content-Type: text/csv');
        header('X-Source: stale-cache');
        readfile($cacheFile);
        exit;
    }
    
    http_response_code(502);
    exit('Remote fetch failed');
}

// Save to cache
file_put_contents($cacheFile, $data);

header('Content-Type: text/csv');
header('X-Source: fresh');
echo $data;
