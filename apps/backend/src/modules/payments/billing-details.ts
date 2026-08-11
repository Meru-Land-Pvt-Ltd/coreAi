export function omitLegacyFreeInstallationValue(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase().replace(/[\s_-]+/g, "");
  return normalized === "freeinstall" || normalized === "freeinstallation"
    ? null
    : trimmed;
}
