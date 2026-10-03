/* =========================================================================
   barcode.js — Strichcodes von Lebensmitteln (EAN-8, UPC-A, EAN-13, GTIN-14):
   Prüfziffer nach GS1 und die Portion aus den Nährwerten je 100 g.
   Reine, DOM-freie Logik → per node:test abgedeckt. Nachgeschlagen wird über den
   eigenen Server (Open Food Facts), nie direkt vom Gerät.
   ========================================================================= */

/** Nur Ziffern, 8–14 Stellen, Prüfziffer stimmt (GS1-Modulo 10). */
export function validGtin(raw) {
  const code = String(raw || '').replace(/\s/g, '');
  if (!/^\d{8,14}$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  // Von rechts: abwechselnd ×3 und ×1 (die Stelle direkt vor der Prüfziffer ×3).
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

/** kcal und Eiweiß für `grams` Gramm aus den Werten je 100 g (null, wenn kcal fehlen). */
export function portionFromProduct(product, grams) {
  const g = Number(String(grams).replace(',', '.'));
  if (!product || !(Number(product.kcal100) > 0) || !(g > 0) || g > 5000) return null;
  const kcal = Math.round((product.kcal100 * g) / 100);
  const protein = Number(product.protein100) >= 0 && product.protein100 != null ? Math.round((product.protein100 * g) / 10) / 10 : null;
  return { kcal, protein };
}
