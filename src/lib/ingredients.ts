// Splits an ingredient line into its amount ("1 ½ cups") and the rest, so the
// amount can be emphasized for quick scanning while cooking.

const NUMBER = String.raw`(?:\d+/\d+|\d+(?:[.,]\d+)?(?:\s*[½⅓⅔¼¾⅛⅜⅝⅞]|\s+\d+/\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])`;
const UNIT = String.raw`(?:cups?|c\.|tablespoons?|tbsps?\.?|tbs\.?|teaspoons?|tsps?\.?|pounds?|lbs?\.?|ounces?|oz\.?|grams?|g|kilograms?|kg|milliliters?|ml|liters?|l|quarts?|qts?\.?|pints?|pts?\.?|gallons?|sticks?|cloves?|cans?|jars?|packages?|pkgs?\.?|pinch(?:es)?|dash(?:es)?|bunch(?:es)?|sprigs?|slices?|handfuls?|heads?|stalks?|inch(?:es)?)`;
const AMOUNT = new RegExp(
  String.raw`^((?:about|scant|heaping|generous)\s+)?${NUMBER}(?:\s*(?:-|–|to)\s*${NUMBER})?(?:\s*\([^)]*\))?(?:\s+${UNIT}\b)?`,
  "i",
);

export function splitAmount(line: string): [amount: string, rest: string] {
  const match = AMOUNT.exec(line);
  if (!match) return ["", line];
  return [match[0], line.slice(match[0].length)];
}
