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
 * Die Funktion respond() stammt aus api.php (bereits geladen).
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
    respond(['ok' => false, 'error' => 'Auf dem Server fehlt die XMLReader-Erweiterung.'], 500);
}

// ---------------------------------------------------------------------------
// 1) Upload ermitteln.
// ---------------------------------------------------------------------------
if (empty($_FILES['file']['tmp_name']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
    respond(['ok' => false, 'error' => 'Keine Datei empfangen (erwartet Feld "file").'], 400);
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
        respond([
            'ok' => false,
            'error' => 'ZIP-Upload erkannt, aber ZipArchive ist auf dem Server nicht verfügbar. '
                     . 'Bitte das ZIP lokal entpacken und nur die Datei export.xml hochladen.',
        ], 500);
    }
    $zip = new ZipArchive();
    if ($zip->open($uploadTmp) !== true) {
        respond(['ok' => false, 'error' => 'ZIP konnte nicht geöffnet werden.'], 400);
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
        respond(['ok' => false, 'error' => 'Im ZIP wurde keine export.xml gefunden.'], 400);
    }
    // Angegebene Größe vorab prüfen (Grenze und Packverhältnis) – beim Entpacken zählt
    // zusätzlich der tatsächliche Inhalt, falls die Angaben im Archiv nicht stimmen.
    $stat = $zip->statName($entry);
    $declared = is_array($stat) ? (int) ($stat['size'] ?? 0) : 0;
    $packed = is_array($stat) ? max(1, (int) ($stat['comp_size'] ?? 0)) : 1;
    if ($declared > HX_MAX_XML_BYTES || $declared / $packed > HX_MAX_RATIO) {
        $zip->close();
        respond(['ok' => false, 'error' => 'Die export.xml im Archiv ist unplausibel groß – Import abgebrochen.'], 413);
    }
    $free = @disk_free_space(sys_get_temp_dir());
    if ($free !== false && $declared + HX_DISK_RESERVE > $free) {
        $zip->close();
        respond(['ok' => false, 'error' => 'Auf dem Server ist nicht genug Platz, um den Export zu entpacken.'], 507);
    }
    $extracted = tempnam(sys_get_temp_dir(), 'hx_');
    $cleanup[] = $extracted;
    $stream = $zip->getStream($entry);
    if ($stream === false) {
        $zip->close();
        foreach ($cleanup as $f) { @unlink($f); }
        respond(['ok' => false, 'error' => 'export.xml konnte nicht gelesen werden.'], 500);
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
        respond(['ok' => false, 'error' => 'Die export.xml im Archiv ist unplausibel groß – Import abgebrochen.'], 413);
    }
    $xmlPath = $extracted;
}


// ---------------------------------------------------------------------------
// 3) Auswerten (reine Logik in health-xml.php, dort auch Einheiten, Schlaf und Datum)
//    und Kandidaten zurückgeben. Das De-Duplizieren passiert im Client.
// ---------------------------------------------------------------------------
require_once __DIR__ . '/health-xml.php';

try {
    $parsed = hx_parse_file($xmlPath);
} catch (RuntimeException $e) {
    foreach ($cleanup as $f) { @unlink($f); }
    respond(['ok' => false, 'error' => $e->getMessage()], 500);
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
