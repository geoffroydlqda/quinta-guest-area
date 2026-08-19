/**
 * Quinta do Amor — Gmail → Receipts auto-ingest
 * ------------------------------------------------
 * Surveille la boîte Gmail : tout email avec une pièce jointe qui ressemble
 * à une facture (fatura / invoice / recibo...) est envoyé automatiquement
 * dans l'onglet Receipts de l'admin (guest.quintamor.com), où il est lu
 * (fournisseur, montant, TVA) et rattaché à la dépense bancaire.
 *
 * Installation (une fois) :
 *   1. script.google.com → New project → coller ce fichier → nommer
 *      "QdA receipts ingest" → Save.
 *   2. Remplacer INGEST_KEY ci-dessous (voir instructions envoyées par Claude).
 *   3. Menu Run → exécuter `ingestReceipts` une fois → autoriser l'accès Gmail.
 *   4. Icône réveil (Triggers) → Add Trigger → ingestReceipts,
 *      Time-driven, Minutes timer, Every 30 minutes → Save.
 *
 * Les emails traités reçoivent le label "qda-ingested" (visible dans Gmail).
 * Pour re-traiter un email : retirer son label et relancer.
 */

var ENDPOINT = "https://fnlgeeuohvethmfpsxpf.supabase.co/functions/v1/receipt-extract";
// Clé anon publique du projet (finit dans le bundle web de toute façon)
var ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZubGdlZXVvaHZldGhtZnBzeHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NDAwNjIsImV4cCI6MjEwMDIxNjA2Mn0.n3lJUIitPBXm2Ro-VGk8INUU1gSz6ZtI4_RLc2qBiF0";
// ⚠ À REMPLACER : Supabase → Table editor → app_settings → ligne "internal"
// → champ value → copier la valeur de "ingest_key"
var INGEST_KEY = "COLLE_LA_CLE_ICI";

// Recherche : PJ + mots-clés facture, 14 derniers jours, pas encore traité
var SEARCH = 'has:attachment (fatura OR factura OR invoice OR recibo OR receipt OR "nota de crédito") -label:qda-ingested newer_than:14d';
var LABEL_NAME = "qda-ingested";
var MAX_THREADS_PER_RUN = 15;

function ingestReceipts() {
  var label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);
  var threads = GmailApp.search(SEARCH, 0, MAX_THREADS_PER_RUN);
  var sent = 0, skipped = 0, errors = 0;

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var atts = messages[m].getAttachments({ includeInlineImages: false, includeAttachments: true });
      for (var a = 0; a < atts.length; a++) {
        var att = atts[a];
        var ct = String(att.getContentType() || "").toLowerCase();
        var isPdf = ct.indexOf("pdf") >= 0;
        var isImg = /jpeg|jpg|png|webp/.test(ct);
        if (!isPdf && !isImg) { skipped++; continue; }
        // Ignore les logos/signatures (petites images)
        if (!isPdf && att.getSize() < 25000) { skipped++; continue; }
        // Ignore les très gros fichiers (> 9 MB)
        if (att.getSize() > 9 * 1024 * 1024) { skipped++; continue; }

        try {
          var payload = {
            ingest: {
              filename: att.getName() || "attachment",
              mime_type: ct,
              content: Utilities.base64Encode(att.getBytes())
            }
          };
          var res = UrlFetchApp.fetch(ENDPOINT, {
            method: "post",
            contentType: "application/json",
            headers: {
              "Authorization": "Bearer " + ANON_KEY,
              "x-ingest-key": INGEST_KEY
            },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
          });
          var code = res.getResponseCode();
          if (code >= 200 && code < 300) { sent++; }
          else { errors++; Logger.log("HTTP " + code + " for " + att.getName() + ": " + res.getContentText().slice(0, 200)); }
        } catch (e) {
          errors++;
          Logger.log("Error for " + att.getName() + ": " + e);
        }
      }
    }
    threads[t].addLabel(label);
  }
  Logger.log("Done: " + sent + " sent, " + skipped + " skipped, " + errors + " errors, " + threads.length + " threads labelled.");
}
