const defaultHeaders = { "Content-Type": "application/json" };

async function fetchJson(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...defaultHeaders, ...(options.headers || {}) },
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const json = JSON.parse(detail);
      detail = json.detail || json.error || detail;
    } catch (_) {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    return { raw: text };
  }
}

export async function getPrimeStatus({ credentialB64, projectId, region }) {
  const params = new URLSearchParams();
  if (credentialB64) params.append("credential", credentialB64);
  if (projectId) params.append("project_id", projectId);
  if (region) params.append("region", region);
  return fetchJson(`/api/trigger/prime-status?${params.toString()}`);
}

export async function primeCustomer(payload) {
  return fetchJson("/api/trigger/prime", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listJobs(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") search.append(k, v);
  });
  const qs = search.toString();
  const url = qs ? `/api/trigger/jobs?${qs}` : "/api/trigger/jobs";
  return fetchJson(url);
}

export async function listTenants() {
  return fetchJson("/api/trigger/tenants");
}

export async function listServices(tenantId) {
  return fetchJson(`/api/trigger/services/${tenantId}`);
}

export async function getJob(jobId) {
  return fetchJson(`/api/trigger/jobs/${encodeURIComponent(jobId)}`);
}

export async function listServiceRevisions(tenantId, serviceName) {
  return fetchJson(`/api/trigger/services/${tenantId}/${serviceName}/revisions`);
}

export async function activateServiceRevision(tenantId, serviceName, body) {
  return fetchJson(`/api/trigger/services/${tenantId}/${serviceName}/revisions/activate`, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export async function healthSummary(tenantId) {
  return fetchJson(`/api/health/summary?tenant_id=${encodeURIComponent(tenantId)}`);
}

export async function triggerDeploy(body) {
  return fetchJson("/api/trigger/deploy", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listDeployConfigs() {
  return fetchJson("/api/deploy-configs");
}

export async function createDeployConfig(body) {
  return fetchJson("/api/deploy-configs", {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export async function updateDeployConfig(id, body) {
  return fetchJson(`/api/deploy-configs/${id}`, {
    method: "PUT",
    body: JSON.stringify(body || {}),
  });
}

export async function deleteDeployConfig(id) {
  return fetchJson(`/api/deploy-configs/${id}`, {
    method: "DELETE",
  });
}

export async function saveConfigFromJob(body) {
  return fetchJson("/api/deploy-configs/from-job", {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export async function fetchServiceConfigFromRun(body) {
  return fetchJson("/api/run/service-config", {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export async function fetchSampleUserrequirements(path) {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  return fetchJson(`/api/deploy/sample-userrequirements${qs}`);
}

export async function fetchRunServices(body) {
  return fetchJson("/api/run/services", {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export async function fetchAgentCatalog() {
  return fetchJson("/api/agent-catalog");
}
