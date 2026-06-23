export function parseAmount(input) {
  if (input === undefined || input === null) return null;
  const s = String(input).trim();
  if (s === "") return null;
  const cleaned = s.replace(/[^\d.-]/g, ""); // keep digits, dot, minus
  if (cleaned === "" || cleaned === "." || cleaned === "-" || cleaned === "-.") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}
