<?php
/**
 * health-import.php — Import eines Apple-Health-Exports.
 *
 * Eingebunden von api.php bei POST ?action=health-import.
 *
 * Ablauf:
 *   1. Datei-Upload entgegennehmen (export.xml ODER das Health-Export-ZIP).
 *   2. Bei ZIP: export.xml herausstreamen (ZipArchive, falls verfügbar).
 *   3. export.xml mit XMLReader streamen (NICHT SimpleXML – die Datei kann
 *      hunderte MB groß sein).
 *   4. Relevante Daten extrahieren:
 *        - Lauf-Workouts            -> Kandidaten für durchgeführte Sessions
 *        - Gewicht/Körperfett/...   -> Kandidaten für den Health-Log (pro Tag)
 *        - Schlafanalyse            -> Schlafstunden pro Nacht (aggregiert)
 *   5. Normalisierte Kandidaten als JSON zurückgeben. Das De-Duplizieren gegen
 *      den lokalen Bestand und das Übernehmen passiert "local-first" im Client
 *      (health-import.js), damit der LocalStorage die führende Quelle bleibt.
 *
 * Die Funktionen respond()/fail() und $session stammen aus api.php (bereits geladen).
 */

declare(strict_types=1);

@set_time_limit(0);

// Obergrenzen gegen „ZIP-Bomben" (winzige Datei, riesiger Inhalt): Ein echter
// export.xml aus vielen Jahren ist einige GB groß und packt sich etwa 10- bis 30-fach.
const HX_MAX_XML_BYTES = 6 * 1024 * 1024 * 1024;   // 6 GiB entpackt
const HX_MAX_RATIO = 200;                          // entpackt / gepackt
const HX_DISK_RESERVE = 256 * 1024 * 1024;         // so viel muss danach frei bleiben

// Externe Entitäten nie laden (XXE), auch auf älteren libxml-Versionen.
libxml_set_external_entity_loader(static fn() => null);

if (!class_exists('XMLReader')) {
    fail('The XMLReader extension is missing on the server.', 500, 'xmlreader_missing');
}

// ---------------------------------------------------------------------------
// 1) Upload ermitteln.
// ---------------------------------------------------------------------------
if (empty($_FILES['file']['tmp_name']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
    fail('No file received (expected field "file").', 400, 'no_file');
}

$uploadTmp  = $_FILES['file']['tmp_name'];
$uploadName = (string) ($_FILES['file']['name'] ?? 'upload');
$xmlPath    = $uploadTmp;
$cleanup    = [];

// ---------------------------------------------------------------------------
// 2) ZIP-Erkennung und Entpacken von export.xml.
// ---------------------------------------------------------------------------
$isZip = preg_match('/\.zip$/i', $uploadName) === 1;
if (!$isZip) {
    // Magic Bytes prüfen ("PK\x03\x04").
    $fh = fopen($uploadTmp, 'rb');
    if ($fh) {
        $sig = fread($fh, 4);
        fclose($fh);
        if ($sig === "PK\x03\x04") {
            $isZip = true;
        }
    }
}

if ($isZip) {
    if (!class_exists('ZipArchive')) {
        fail('ZIP upload detected, but ZipArchive is not available on the server. '
           . 'Please unzip the archive locally and upload only the file export.xml.', 500, 'zip_unavailable');
    }
    $zip = new ZipArchive();
    if ($zip->open($uploadTmp) !== true) {
        fail('The ZIP could not be opened.', 400, 'zip_unreadable');
    }
    // export.xml im Archiv finden (liegt meist unter apple_health_export/export.xml).
    $entry = null;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if ($name !== false && preg_match('#(^|/)export\.xml$#i', $name)) {
            $entry = $name;
            break;
        }
    }
    if ($entry === null) {
        $zip->close();
        fail('No export.xml found in the ZIP.', 400, 'zip_no_export');
    }
    // Angegebene Größe vorab prüfen (Grenze und Packverhältnis) – beim Entpacken zählt
    // zusätzlich der tatsächliche Inhalt, falls die Angaben im Archiv nicht stimmen.
    $stat = $zip->statName($entry);
    $declared = is_array($stat) ? (int) ($stat['size'] ?? 0) : 0;
    $packed = is_array($stat) ? max(1, (int) ($stat['comp_size'] ?? 0)) : 1;
    if ($declared > HX_MAX_XML_BYTES || $declared / $packed > HX_MAX_RATIO) {
        $zip->close();
        fail('The export.xml in the archive is implausibly large – import cancelled.', 413, 'export_too_large');
    }
    $free = @disk_free_space(sys_get_temp_dir());
    if ($free !== false && $declared + HX_DISK_RESERVE > $free) {
        $zip->close();
        fail('There is not enough space on the server to unpack the export.', 507, 'disk_full');
    }
    $extracted = tempnam(sys_get_temp_dir(), 'hx_');
    $cleanup[] = $extracted;
    $stream = $zip->getStream($entry);
    if ($stream === false) {
        $zip->close();
        foreach ($cleanup as $f) { @unlink($f); }
        fail('export.xml could not be read.', 500, 'export_unreadable');
    }
    $out = fopen($extracted, 'wb');
    $written = 0;
    $tooBig = false;
    while (!feof($stream)) {
        $chunk = fread($stream, 1 << 20);
        if ($chunk === false || $chunk === '') {
            break;
        }
        $written += strlen($chunk);
        if ($written > HX_MAX_XML_BYTES || $written / $packed > HX_MAX_RATIO * 1.05) {
            $tooBig = true;
            break;
        }
        fwrite($out, $chunk);
    }
    fclose($out);
    fclose($stream);
    $zip->close();
    if ($tooBig) {
        foreach ($cleanup as $f) { @unlink($f); }
        fail('The export.xml in the archive is implausibly large – import cancelled.', 413, 'export_too_large');
    }
    $xmlPath = $extracted;
}


// ---------------------------------------------------------------------------
// 3) Auswerten (reine Logik in health-xml.php, dort auch Einheiten, Schlaf und Datum)
//    und Kandidaten zurückgeben. Das De-Duplizieren passiert im Client.
// ---------------------------------------------------------------------------
require_once __DIR__ . '/health-xml.php';

try {
    // Session titles in the language of the signed-in person (who sees the import).
    $parsed = hx_parse_file($xmlPath, person_language($session['user'] ?? null));
} catch (RuntimeException $e) {
    foreach ($cleanup as $f) { @unlink($f); }
    fail($e->getMessage(), 500, 'export_open_failed');
}
foreach ($cleanup as $f) { @unlink($f); }

respond([
    'ok' => true,
    'summary' => [
        'workouts'    => count($parsed['workouts']),
        'healthDays'  => count($parsed['health']),
        'sleepNights' => $parsed['sleepNights'],
        'periods'     => count($parsed['periods'] ?? []),
    ],
    'workouts' => $parsed['workouts'],
    'health'   => $parsed['health'],
    // Zyklus nur zur Übernahme in den eigenen, privaten Bereich – die App fragt vorher.
    'periods'  => $parsed['periods'] ?? [],
]);
