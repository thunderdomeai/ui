export const DEFAULT_CREDENTIAL_LABELS = new Set([
  "source project service account",
  "target project service account",
  "source project service account (legacy)",
  "target project service account (legacy)",
]);

export function formatCredentialLabel(entryId, entryValue) {
  const providedLabel = typeof entryValue?.label === "string" ? entryValue.label.trim() : "";
  const credential = entryValue?.credential ?? {};
  const projectId = typeof credential?.project_id === "string" ? credential.project_id.trim() : "";
  const clientEmail = typeof credential?.client_email === "string" ? credential.client_email.trim() : "";

  const fallbackParts = [];
  if (projectId) {
    fallbackParts.push(projectId);
  }
  if (clientEmail && !fallbackParts.includes(clientEmail)) {
    fallbackParts.push(clientEmail);
  }

  const fallbackLabel = fallbackParts.length > 0 ? fallbackParts.join(" • ") : entryId;

  if (!providedLabel) {
    return fallbackLabel;
  }

  const normalizedLabel = providedLabel.toLowerCase();
  if (normalizedLabel === entryId.toLowerCase() || DEFAULT_CREDENTIAL_LABELS.has(normalizedLabel)) {
    return fallbackLabel;
  }

  return providedLabel;
}
