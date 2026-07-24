const COMBINING_DIACRITICS = /[̀-ͯ]/g;

function normalizeLetter(char: string): string {
  const stripped = char.normalize("NFD").replace(COMBINING_DIACRITICS, "");
  return /[a-zA-Z]/.test(stripped) ? stripped.toUpperCase() : "X";
}

/** e.g. "Julio" -> "J482910O" (first letter + 6 random digits + last letter) */
export function generateRoomCode(creatorName: string): string {
  const trimmed = creatorName.trim();
  const first = trimmed.length > 0 ? normalizeLetter(trimmed[0]) : "X";
  const last = trimmed.length > 0 ? normalizeLetter(trimmed[trimmed.length - 1]) : "X";
  const digits = Math.floor(100000 + Math.random() * 900000).toString();
  return `${first}${digits}${last}`;
}
