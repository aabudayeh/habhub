export const CURRENT_TERMS_VERSION = "2026-09-04";
export const CURRENT_PRIVACY_VERSION = "2026-09-04";

export function policyVersionLabel(version: string) {
  const [year, month, day] = version.split("-");
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(parsed.valueOf())) return version;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
