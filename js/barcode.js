/* =========================================================================
   barcode.js — barcodes of food products (EAN-8, UPC-A, EAN-13, GTIN-14):
   check digit per GS1 and the portion from the nutrition values per 100 g.
   Pure, DOM-free logic → covered by node:test. Lookups go through the
   own server (Open Food Facts), never directly from the device.
   ========================================================================= */

/** Digits only, 8–14 digits, check digit is correct (GS1 modulo 10). */
export function validGtin(raw) {
  const code = String(raw || '').replace(/\s/g, '');
  if (!/^\d{8,14}$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  // From the right: alternately ×3 and ×1 (the digit directly before the check digit ×3).
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

/** kcal and protein for `grams` grams from the values per 100 g (null if kcal are missing). */
export function portionFromProduct(product, grams) {
  const g = Number(String(grams).replace(',', '.'));
  if (!product || !(Number(product.kcal100) > 0) || !(g > 0) || g > 5000) return null;
  const kcal = Math.round((product.kcal100 * g) / 100);
  const protein = Number(product.protein100) >= 0 && product.protein100 != null ? Math.round((product.protein100 * g) / 10) / 10 : null;
  return { kcal, protein };
}
