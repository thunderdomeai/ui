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
    const error = new Error(detail || `Request failed (${res.status})`);
    error.status = res.status;
    error.detail = detail;
    throw error;
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

export async function verifyCredentialEntry(type, entryId, payload = {}) {
  return fetchJson(`/api/credential-store/${type}/entries/${encodeURIComponent(entryId)}/verify`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

export async function markCredentialPrimed(type, entryId, payload = {}) {
  return fetchJson(`/api/credential-store/${type}/entries/${encodeURIComponent(entryId)}/mark-primed`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
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

export async function getJobStatus(jobProjectId, jobRegion, jobName, executionName) {
  const path = `/api/trigger/job_status/${encodeURIComponent(jobProjectId)}/${encodeURIComponent(
    jobRegion,
  )}/${encodeURIComponent(jobName)}/${encodeURIComponent(executionName)}`;
  return fetchJson(path);
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

export async function fetchTenantStackTemplate() {
  return fetchJson("/api/tenant-stack/template");
}

export async function listTenantStackTemplates() {
  return fetchJson("/api/tenant-stack/templates");
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

export async function fetchProviderHealth() {
  return fetchJson("/api/provider/health");
}

export async function listSqlInstances() {
  return fetchJson("/api/sql/instances");
}

export async function listSqlDatabases(instanceName) {
  return fetchJson(`/api/sql/instances/${encodeURIComponent(instanceName)}/databases`);
}

export async function validateBucketName(scope, name) {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (name) params.set("name", name);
  return fetchJson(`/api/validate/bucket-name?${params.toString()}`);
}

export async function validateSqlDatabase(instance, database, scope) {
  const params = new URLSearchParams();
  if (instance) params.set("instance", instance);
  if (database) params.set("database", database);
  if (scope) params.set("scope", scope);
  return fetchJson(`/api/sql/validate-database?${params.toString()}`);
}

export async function bootstrapProvider(body = {}) {
  return fetchJson("/api/bootstrap/provider", {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export async function finalizeTenantStack(body = {}) {
  return fetchJson("/api/tenant-stack/finalize", {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export async function runMassDeploy({
  projectId,
  region,
  branch,
  repoUrl,
  dryRun = false,
  includeSchedulers = false,
  deploymentTag,
} = {}) {
  const body = {
    ...(projectId ? { project_id: projectId } : {}),
    ...(region ? { region } : {}),
    ...(branch ? { branch } : {}),
    ...(repoUrl ? { repo_url: repoUrl } : {}),
    dry_run: !!dryRun,
    include_schedulers: !!includeSchedulers,
  };
  if (deploymentTag) {
    body.deployment_tag = deploymentTag;
  }
  return fetchJson("/api/thunderdeploy/deploy-agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --- Database Setup Wizard APIs ---

export async function sqlPreflightCheck(scope = "source") {
  return fetchJson(`/api/sql/preflight-check?scope=${scope}`);
}

export async function sqlInstancesList(scope = "source") {
  return fetchJson(`/api/sql/instances-list?scope=${scope}`);
}

export async function sqlInstancesCreate({ name, region, tier, databaseVersion, scope = "source" }) {
  return fetchJson("/api/sql/instances-create", {
    method: "POST",
    body: JSON.stringify({
      name,
      region: region || "us-central1",
      tier: tier || "db-f1-micro",
      database_version: databaseVersion || "POSTGRES_15",
      scope,
    }),
  });
}

export async function sqlOperationStatus(operationId) {
  return fetchJson(`/api/sql/operations/${encodeURIComponent(operationId)}`);
}

export async function sqlDatabasesCreate({ instance, database, scope = "source" }) {
  return fetchJson("/api/sql/databases-create", {
    method: "POST",
    body: JSON.stringify({ instance, database, scope }),
  });
}

export async function sqlUsersList(instance, scope = "source") {
  return fetchJson(`/api/sql/users-list?instance=${encodeURIComponent(instance)}&scope=${scope}`);
}

export async function sqlUsersCreate({ instance, username, password, scope = "source" }) {
  return fetchJson("/api/sql/users-create", {
    method: "POST",
    body: JSON.stringify({ instance, username, password, scope }),
  });
}
