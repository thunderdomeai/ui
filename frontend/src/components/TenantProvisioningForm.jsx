import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Paper,
  CircularProgress,
  Alert,
  Snackbar,
  Autocomplete,
  RadioGroup,
  FormControlLabel,
  Radio,
} from "@mui/material";
import { RocketLaunch } from "@mui/icons-material";

import {
  fetchTenantStackTemplate,
  triggerDeploy,
  listJobs,
  getJob,
  listSqlInstances,
  listSqlDatabases,
  finalizeTenantStack,
  validateSqlDatabase,
} from "../utils/api.js";

const defaultGithubToken =
  import.meta.env.VITE_GITHUB_TOKEN ||
  (typeof window !== "undefined" && window.__UNIFIED_UI_CONFIG__?.githubToken) ||
  "";

const parseDotEnvToArray = (text, defaultsMap) => {
  const lookup = defaultsMap instanceof Map
    ? defaultsMap
    : defaultsMap
      ? new Map(Object.entries(defaultsMap))
      : new Map();
  const lines = text.split("\n");
  const envArr = [];
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    const matchesExample = lookup.has(key) && lookup.get(key) === value;
    envArr.push({ key, value, matchesExample });
  });
  return envArr;
};

const cloneEnvVarArray = (arr = []) => arr.map(({ key, value, matchesExample }) => ({
  key,
  value,
  matchesExample: !!matchesExample,
}));

const decodeBase64Content = (base64Text) => {
  if (!base64Text) return "";
  if (typeof window !== "undefined" && typeof window.atob === "function") {
    return window.atob(base64Text);
  }
  if (typeof atob === "function") {
    return atob(base64Text);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64Text, "base64").toString("utf-8");
  }
  throw new Error("Unable to decode base64 content in this environment.");
};

function applyTenantPlaceholders(userrequirements, { tenantProjectId, tenantSlug, region, dbInstance, dbName }) {
  const cloned = JSON.parse(JSON.stringify(userrequirements));

  const replaceInValue = (value) => {
    if (typeof value !== "string") return value;
    let v = value;
    v = v.replace(/{{PROJECT_ID}}/g, tenantProjectId);
    v = v.replace(/{{TENANT_ID}}/g, tenantSlug);
    v = v.replace(/{{REGION}}/g, region);
    v = v.replace(/{{DB_INSTANCE}}/g, dbInstance);
    v = v.replace(/{{DB_NAME}}/g, dbName);
    return v;
  };

  const walk = (node) => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === "object") {
      const result = {};
      Object.entries(node).forEach(([k, v]) => {
        result[k] = walk(v);
      });
      return result;
    }
    return replaceInValue(node);
  };

  return walk(cloned);
}

function fillGithubToken(userrequirements, githubToken) {
  if (!githubToken) return userrequirements;
  const cloned = JSON.parse(JSON.stringify(userrequirements));
  const maybeSetToken = (env) => {
    if (!env || typeof env !== "object") return env;
    const token = env.github_token;
    if (!token || typeof token !== "string" || token.includes("REPLACE_ME") || token === "PLACEHOLDER") {
      return { ...env, github_token: githubToken };
    }
    return env;
  };
  if (Array.isArray(cloned.agents)) {
    cloned.agents = cloned.agents.map((agent) => ({
      ...agent,
      environment: maybeSetToken(agent.environment),
    }));
  }
  if (Array.isArray(cloned.repositories)) {
    cloned.repositories = cloned.repositories.map((repo) => ({
      ...repo,
      environment: maybeSetToken(repo.environment),
    }));
  }
  return cloned;
}

export default function TenantProvisioningForm({ serviceAccount, customerServiceAccount, providerHealth }) {
  const [formData, setFormData] = useState({
    clientName: "",
    projectId: "",
    region: "us-central1",
    dbAlias: "",
    users: "",
  });
  const [deploying, setDeploying] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState(null);
  const [deploymentLog, setDeploymentLog] = useState("");
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [configSource, setConfigSource] = useState("template");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [availableJobs, setAvailableJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobLoadError, setJobLoadError] = useState("");
  const [sqlInstances, setSqlInstances] = useState([]);
  const [sqlInstancesLoading, setSqlInstancesLoading] = useState(false);
  const [sqlInstancesError, setSqlInstancesError] = useState("");
  const [selectedInstanceName, setSelectedInstanceName] = useState("");
  const [sqlDatabases, setSqlDatabases] = useState([]);
  const [sqlDatabasesLoading, setSqlDatabasesLoading] = useState(false);
  const [sqlDatabasesError, setSqlDatabasesError] = useState("");
  const [selectedDatabaseName, setSelectedDatabaseName] = useState("");
  const [dbValidation, setDbValidation] = useState({ status: null, message: "" });
  const credentialsMissing = !serviceAccount || !customerServiceAccount;
  const providerStatus = providerHealth?.overall_status || null;
  const providerBlocked = providerStatus === "error";

  const jobIdentifier = (job) =>
    job?.job_identifier || job?.job_key || job?.job_execution_name || job?.instance_id || job?.id || "";

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const fetchAvailableJobs = async () => {
    setLoadingJobs(true);
    setJobLoadError("");
    try {
      const data = await listJobs();
      const jobs = data.jobs || data.items || [];
      setAvailableJobs(jobs);
      if (!selectedJobId && jobs.length > 0) {
        const firstId = jobIdentifier(jobs[0]);
        if (firstId) setSelectedJobId(firstId);
      }
    } catch (error) {
      setJobLoadError(error.message || "Failed to load jobs.");
    } finally {
      setLoadingJobs(false);
    }
  };

  const loadSqlInstances = async () => {
    setSqlInstancesLoading(true);
    setSqlInstancesError("");
    try {
      const data = await listSqlInstances();
      const instances = Array.isArray(data.instances) ? data.instances : [];
      setSqlInstances(instances);
    } catch (error) {
      console.error("Failed to load SQL instances:", error);
      setSqlInstancesError(error.message || "Failed to load SQL instances.");
    } finally {
      setSqlInstancesLoading(false);
    }
  };

  const loadSqlDatabases = async (instanceName) => {
    if (!instanceName) {
      setSqlDatabases([]);
      setSelectedDatabaseName("");
      return;
    }
    setSqlDatabasesLoading(true);
    setSqlDatabasesError("");
    try {
      const data = await listSqlDatabases(instanceName);
      const dbs = Array.isArray(data.databases) ? data.databases : [];
      setSqlDatabases(dbs);
      if (dbs.length === 1) {
        setSelectedDatabaseName(dbs[0].name);
      }
    } catch (error) {
      console.error("Failed to load SQL databases:", error);
      setSqlDatabasesError(error.message || "Failed to load SQL databases.");
    } finally {
      setSqlDatabasesLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedInstanceName || !selectedDatabaseName) {
      setDbValidation({ status: null, message: "" });
      return;
    }
    const existing = sqlDatabases.find((db) => db.name === selectedDatabaseName);
    if (existing) {
      setDbValidation({ status: "exists", message: `Using existing database ${selectedDatabaseName}.` });
      return;
    }
    let cancelled = false;
    setDbValidation({ status: "checking", message: "Validating database name..." });
    validateSqlDatabase(selectedInstanceName, selectedDatabaseName, "target")
      .then((result) => {
        if (cancelled) return;
        const status = result?.status || "unknown";
        const message = result?.message || status;
        setDbValidation({ status, message });
      })
      .catch((error) => {
        if (cancelled) return;
        const detail = error?.detail || error?.message || "Failed to validate database name.";
        setDbValidation({ status: "unknown", message: detail });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedInstanceName, selectedDatabaseName, sqlDatabases]);

  useEffect(() => {
    if (configSource === "existingJob" && availableJobs.length === 0 && !loadingJobs) {
      fetchAvailableJobs().catch((err) => {
        console.error("Error fetching jobs for reuse:", err);
        setJobLoadError(err.message || "Failed to load jobs.");
      });
    }
  }, [configSource, availableJobs.length, loadingJobs]);

  useEffect(() => {
    if (!sqlInstances.length && !sqlInstancesLoading) {
      loadSqlInstances().catch((err) => console.error("Error loading SQL instances on mount:", err));
    }
  }, [sqlInstances.length, sqlInstancesLoading]);

  useEffect(() => {
    if (selectedInstanceName) {
      loadSqlDatabases(selectedInstanceName).catch((err) => console.error("Error loading SQL databases on change:", err));
    }
  }, [selectedInstanceName]);

  const fetchEnvSourcesForRepo = async (repoUrl, branch) => {
    if (!repoUrl) return { envVars: [], selectedSourceName: null, foundEnv: false, foundExample: false };
    const cleaned = repoUrl.replace(/\.git$/, "");
    const parts = cleaned.split("/");
    if (parts.length < 5) {
      console.warn(`Repository URL format unexpected: ${repoUrl}`);
      return { envVars: [], selectedSourceName: null, foundEnv: false, foundExample: false };
    }
    const owner = parts[3];
    const repoNameFromUrl = parts[4];
    const baseUrl = `https://api.github.com/repos/${owner}/${repoNameFromUrl}/contents`;
    const headers = defaultGithubToken ? { Authorization: `token ${defaultGithubToken}` } : {};

    const fetchEnvFile = async (fileName) => {
      const response = await fetch(`${baseUrl}/${fileName}?ref=${branch || "main"}`, { headers });
      if (response.status === 404) {
        return { found: false, content: null };
      }
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const content = data && data.content && data.encoding === "base64" ? decodeBase64Content(data.content) : "";
      return { found: true, content };
    };

    let envResult = { found: false, content: null };
    let exampleResult = { found: false, content: null };
    try {
      envResult = await fetchEnvFile(".env");
    } catch (error) {
      console.error(`Error fetching .env for ${repoUrl}:`, error);
    }
    try {
      exampleResult = await fetchEnvFile(".env.example");
    } catch (error) {
      console.error(`Error fetching .env.example for ${repoUrl}:`, error);
    }

    const exampleDefaultsMap = exampleResult.found && exampleResult.content !== null
      ? new Map(parseDotEnvToArray(exampleResult.content).map(({ key, value }) => [key, value]))
      : new Map();

    const exampleEnvArray = exampleResult.found && exampleResult.content !== null
      ? parseDotEnvToArray(exampleResult.content, exampleDefaultsMap)
      : [];

    const envArray = envResult.found && envResult.content !== null
      ? parseDotEnvToArray(envResult.content, exampleDefaultsMap)
      : [];

    const envSources = [];
    if (envResult.found) {
      envSources.push({ name: ".env", envVars: cloneEnvVarArray(envArray) });
    }
    if (exampleResult.found) {
      envSources.push({ name: ".env.example", envVars: cloneEnvVarArray(exampleEnvArray) });
    }

    let selectedSourceName = null;
    if (envResult.found) {
      selectedSourceName = ".env";
    } else if (exampleResult.found) {
      selectedSourceName = ".env.example";
    }

    const selectedEnvVars = selectedSourceName
      ? cloneEnvVarArray((envSources.find((src) => src.name === selectedSourceName)?.envVars) || [])
      : [];

    return {
      envVars: selectedEnvVars,
      selectedSourceName,
      foundEnv: envResult.found,
      foundExample: exampleResult.found,
    };
  };

  const buildEnvFileUserrequirements = async (baseUserrequirements) => {
    const cloned = JSON.parse(JSON.stringify(baseUserrequirements));
    const missingEnvSources = [];
    if (!Array.isArray(cloned.agents)) {
      return { userrequirements: cloned, missingEnvSources };
    }

    for (const agent of cloned.agents) {
      const envConfig = agent.environment || {};
      const repoUrl = envConfig.repo_url;
      const branch = envConfig.branch || "main";
      const { envVars, selectedSourceName, foundEnv, foundExample } = await fetchEnvSourcesForRepo(repoUrl, branch);
      if (selectedSourceName) {
        agent.environment = {
          ...envConfig,
          extra_env: envVars,
          extra_env_source: selectedSourceName,
        };
      } else if (!foundEnv && !foundExample) {
        missingEnvSources.push(agent.name || repoUrl || "agent");
        agent.environment = { ...envConfig };
      }
    }

    return { userrequirements: cloned, missingEnvSources };
  };

  const handleDeploy = async () => {
    if (providerBlocked) {
      setSnackbarMessage("Provider setup is not healthy enough to provision tenants. Check the Provider status above.");
      setSnackbarOpen(true);
      return;
    }

    if (credentialsMissing) {
      setSnackbarMessage("Please upload both Source and Target Service Accounts in the Credential Manager first.");
      setSnackbarOpen(true);
      return;
    }

    if (!formData.clientName || !formData.projectId) {
      setSnackbarMessage("Client Name and Project ID are required.");
      setSnackbarOpen(true);
      return;
    }
    if (!selectedInstanceName || !selectedDatabaseName) {
      setSnackbarMessage("Select a Cloud SQL instance and database before provisioning.");
      setSnackbarOpen(true);
      return;
    }
    if (dbValidation.status === "instance_not_found" || dbValidation.status === "invalid_name") {
      setSnackbarMessage(dbValidation.message || "Database validation failed. Please choose a different database or instance.");
      setSnackbarOpen(true);
      return;
    }

    setDeploying(true);
    setDeploymentStatus(null);
    setDeploymentLog("Submitting tenant provisioning job...");

    try {
      const tenantProjectId = formData.projectId.trim();
      const region = (formData.region || "").trim() || "us-central1";
      const tenantSlug = formData.clientName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "tenant";
      const selectedInstance = sqlInstances.find((inst) => inst.name === selectedInstanceName) || null;
      const connectionName = selectedInstance?.connectionName || "";
      if (!connectionName) {
        throw new Error("Selected Cloud SQL instance is missing a connection name.");
      }
      const dbName = selectedDatabaseName;
      const dbAliasLabel = (formData.dbAlias || "").trim() || dbName;

      const tenantConfig = {
        client_name: formData.clientName,
        project_id: tenantProjectId,
        region,
        db_alias: dbAliasLabel,
        users: formData.users,
      };

      let baseUserrequirements = null;
      let missingEnvSources = [];

      if (configSource === "template" || configSource === "envFiles") {
        const templateResponse = await fetchTenantStackTemplate();
        baseUserrequirements = templateResponse?.userrequirements;
        if (!baseUserrequirements || typeof baseUserrequirements !== "object") {
          throw new Error("Tenant stack template is missing or invalid.");
        }

        if (configSource === "envFiles") {
          const envResult = await buildEnvFileUserrequirements(baseUserrequirements);
          baseUserrequirements = envResult.userrequirements;
          missingEnvSources = envResult.missingEnvSources;
        }
      } else if (configSource === "existingJob") {
        if (!selectedJobId) {
          setSnackbarMessage("Select a deployment job to reuse configuration from.");
          setSnackbarOpen(true);
          setDeploying(false);
          return;
        }
        const jobRecord = await getJob(selectedJobId);
        baseUserrequirements =
          jobRecord?.userrequirements ||
          jobRecord?.metadata?.userrequirements ||
          null;
        if (!baseUserrequirements || typeof baseUserrequirements !== "object") {
          throw new Error("Selected job does not expose userrequirements for reuse.");
        }
      }

      if (!baseUserrequirements) {
        throw new Error("Unable to build userrequirements for deployment.");
      }

      const userrequirements = applyTenantPlaceholders(baseUserrequirements, {
        tenantProjectId,
        tenantSlug,
        region,
        dbInstance: connectionName,
        dbName,
      });

      const tenantMetadata = {
        project_id: tenantProjectId,
        tenant_slug: tenantSlug,
        region,
        database_instance: connectionName,
        database_name: dbName,
      };

      const finalizeResp = await finalizeTenantStack({
        userrequirements,
        tenant_metadata: tenantMetadata,
      });

      const finalizedUserrequirements =
        finalizeResp?.userrequirements && typeof finalizeResp.userrequirements === "object"
          ? finalizeResp.userrequirements
          : userrequirements;

      const finalUserrequirements = {
        ...finalizedUserrequirements,
        tenant_config: tenantConfig,
      };
      const finalUserrequirementsWithToken = fillGithubToken(finalUserrequirements, defaultGithubToken);

      const responseData = await triggerDeploy({
        userrequirements: finalUserrequirementsWithToken,
        serviceaccount: serviceAccount,
        customer_serviceaccount: customerServiceAccount,
      });

      const envWarnings =
        configSource === "envFiles" && missingEnvSources.length > 0
          ? `\n\nEnv files not found for: ${missingEnvSources.join(", ")} (using template defaults).`
          : "";

      if (Array.isArray(responseData.results)) {
        const summaryLines = responseData.results.map((r) =>
          `${r.instance_id || r.service_name || "instance"}: ${r.status_overall_job_execution || r.status || "submitted"}`,
        );
        setDeploymentStatus("success");
        setDeploymentLog(
          `Tenant stack deployment submitted using config source: ${configSource}.${envWarnings}\n\nJobs:\n${summaryLines.join("\n")}\n\nRaw response:\n${JSON.stringify(responseData, null, 2)}`,
        );
      } else {
        setDeploymentStatus("success");
        setDeploymentLog(
          `Tenant stack deployment submitted using config source: ${configSource}.${envWarnings}\n\nResponse:\n${JSON.stringify(responseData, null, 2)}`,
        );
      }
    } catch (error) {
      console.error("Error triggering tenant stack deployment:", error);
      const detail = error?.detail || error?.message || "Unknown error";
      const message =
        typeof detail === "string"
          ? detail
          : detail?.message
            ? `${detail.message}${
                Array.isArray(detail.placeholders) && detail.placeholders.length
                  ? ` (unresolved: ${detail.placeholders.join(", ")})`
                  : ""
              }`
            : "Unknown error";
      const isTimeout =
        error?.status === 504 ||
        message.toLowerCase().includes("timeout") ||
        message.toLowerCase().includes("too long");
      if (isTimeout) {
        setDeploymentStatus("warning");
        setDeploymentLog(
          `Deployment submission timed out, but jobs may still have been accepted. ` +
          `Check the Deployment Dashboard or job history for updates.\n\nDetails: ${message}`,
        );
      } else {
        setDeploymentStatus("error");
        setDeploymentLog(`Error: ${message}`);
      }
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 800, mx: "auto" }}>
      <Typography variant="h5" gutterBottom sx={{ color: "primary.main", fontWeight: 600 }}>
        Provision New Tenant
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Deploy a full Agent One tenant stack (10 agents) for a new tenant, using the standard template. This includes core agents, MCP/broker wiring, and database configuration.
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Configuration Source
        </Typography>
        <RadioGroup
          value={configSource}
          onChange={(e) => setConfigSource(e.target.value)}
        >
          <FormControlLabel
            value="template"
            control={<Radio />}
            label="Known-good 10-agent template (recommended)"
          />
          <FormControlLabel
            value="envFiles"
            control={<Radio />}
            label=".env / .env.example from repos"
          />
          {configSource === "envFiles" && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 4, mt: -1.5, mb: 1.5 }}>
              Use repository env files to populate agent environment variables, keeping the standard stack structure.
            </Typography>
          )}
          <FormControlLabel
            value="existingJob"
            control={<Radio />}
            label="Reuse an existing deployment job"
          />
          {configSource === "existingJob" && (
            <Box sx={{ ml: 4, mt: 1 }}>
              {loadingJobs ? (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2">Loading previous jobs...</Typography>
                </Box>
              ) : (
                <Autocomplete
                  freeSolo
                  options={availableJobs.map((job) => {
                    const id = jobIdentifier(job);
                    const status = job?.deployment_outcome || job?.job_status || job?.status || "";
                    return id ? `${id}${status ? ` — ${status}` : ""}` : null;
                  }).filter(Boolean)}
                  value={selectedJobId}
                  onChange={(_, newValue) => setSelectedJobId((newValue || "").split(" — ")[0])}
                  onInputChange={(_, newInputValue) => setSelectedJobId(newInputValue || "")}
                  onOpen={() => {
                    if (availableJobs.length === 0 && !loadingJobs) {
                      fetchAvailableJobs().catch((err) => console.error("Error fetching jobs on open:", err));
                    }
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Deployment Job ID"
                      helperText="Select or enter a previous job identifier to reuse its configuration"
                    />
                  )}
                />
              )}
              {jobLoadError && (
                <Typography variant="caption" color="error">
                  {jobLoadError}
                </Typography>
              )}
            </Box>
          )}
        </RadioGroup>
      </Box>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Client Name"
            name="clientName"
            value={formData.clientName}
            onChange={handleChange}
            helperText="Unique identifier for the client (e.g., acme-corp)"
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="GCP Project ID"
            name="projectId"
            value={formData.projectId}
            onChange={handleChange}
            helperText="Target GCP Project ID"
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Region"
            name="region"
            value={formData.region}
            onChange={handleChange}
            helperText="GCP Region (default: us-central1)"
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <Autocomplete
            options={sqlInstances}
            getOptionLabel={(inst) =>
              inst && inst.name ? `${inst.name}${inst.region ? ` (${inst.region})` : ""}` : ""
            }
            loading={sqlInstancesLoading}
            value={sqlInstances.find((inst) => inst.name === selectedInstanceName) || null}
            onOpen={() => {
              if (!sqlInstances.length && !sqlInstancesLoading) {
                loadSqlInstances().catch((err) => console.error("Error loading SQL instances on open:", err));
              }
            }}
            onChange={(_, newValue) => {
              const name = newValue?.name || "";
              setSelectedInstanceName(name);
              setSelectedDatabaseName("");
              loadSqlDatabases(name).catch((err) => console.error("Error loading SQL databases from instance change:", err));
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                fullWidth
                label="Cloud SQL Instance"
                helperText={sqlInstancesError || "Select an existing Cloud SQL instance in the target project."}
              />
            )}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <Autocomplete
            freeSolo
            options={sqlDatabases.map((db) => db?.name || "").filter(Boolean)}
            loading={sqlDatabasesLoading}
            value={selectedDatabaseName}
            onChange={(_, newValue) => {
              setSelectedDatabaseName(newValue || "");
            }}
            onInputChange={(_, newInputValue) => {
              setSelectedDatabaseName(newInputValue || "");
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                fullWidth
                label="Database"
                helperText={
                  sqlDatabasesError ||
                  dbValidation.message ||
                  "Select or enter a database in the chosen instance."
                }
              />
            )}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Database Alias (optional)"
            name="dbAlias"
            value={formData.dbAlias}
            onChange={handleChange}
            helperText="Optional label for your own tracking (not used for connection)."
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Users (Comma Separated)"
            name="users"
            value={formData.users}
            onChange={handleChange}
            helperText="List of user IDs to map to this tenant"
          />
        </Grid>

        <Grid item xs={12} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            color="primary"
            size="large"
            startIcon={deploying ? <CircularProgress size={20} color="inherit" /> : <RocketLaunch />}
            onClick={handleDeploy}
            disabled={deploying || credentialsMissing || providerBlocked}
            fullWidth
          >
            {deploying ? "Provisioning..." : "Provision Tenant"}
          </Button>
          {credentialsMissing && (
            <Typography variant="caption" color="text.secondary" display="block" textAlign="center" sx={{ mt: 1 }}>
              Activate source and target credentials in Credential Manager to enable provisioning.
            </Typography>
          )}
          {providerBlocked && (
            <Typography variant="caption" color="error" display="block" textAlign="center" sx={{ mt: 1 }}>
              Provider setup is blocking provisioning. Check TriggerService and credentials (see Provider status above).
            </Typography>
          )}
        </Grid>
      </Grid>

      {deploymentLog && (
        <Box sx={{ mt: 3 }}>
          <Alert
            severity={
              deploymentStatus === "error"
                ? "error"
                : deploymentStatus === "warning"
                  ? "warning"
                  : "success"
            }
          >
            <Typography variant="subtitle2" fontWeight="bold">
              {deploymentStatus === "error"
                ? "Deployment Failed"
                : deploymentStatus === "warning"
                  ? "Deployment Submitted (timeout waiting for response)"
                  : "Deployment Initiated"}
            </Typography>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "0.85rem", marginTop: "8px" }}>
              {deploymentLog}
            </pre>
          </Alert>
        </Box>
      )}

      <Snackbar open={snackbarOpen} autoHideDuration={6000} onClose={() => setSnackbarOpen(false)} message={snackbarMessage} />
    </Paper>
  );
}

TenantProvisioningForm.propTypes = {
  serviceAccount: PropTypes.object,
  customerServiceAccount: PropTypes.object,
  providerHealth: PropTypes.object,
};
