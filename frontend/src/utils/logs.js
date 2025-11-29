export async function fetchServiceLogs({ serviceAccount, projectId, serviceName, region = "us-central1", limit = 200 }) {
  const res = await fetch("/api/logs/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_account: serviceAccount,
      project_id: projectId,
      service_name: serviceName,
      region,
      limit,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || "Failed to fetch logs");
  }
  return res.json();
}
