<?php
// Cat-O-Fit — container health check: the API must return {"ok":true,…}.
$response = @file_get_contents('http://127.0.0.1/api/api.php?action=ping');
$json = json_decode((string) $response, true);
exit(is_array($json) && ($json['ok'] ?? false) === true ? 0 : 1);
