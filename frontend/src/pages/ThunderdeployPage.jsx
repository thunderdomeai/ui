import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { Link as RouterLink, useLocation } from "react-router-dom";
import {
  Box,
  Typography,
  TextField,
  Button,
  Checkbox,
  FormControlLabel,
  Grid,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
  Paper,
  Link,
  Stack,
  Chip,
} from "@mui/material";
import { Add, Delete, HelpOutline, Launch, Refresh, Link as LinkIcon, FileCopy as FileCopyIcon, Download as DownloadIcon, VpnKey } from "@mui/icons-material";
import { useCredentialStore } from "../hooks/credentials/useCredentialStores.js";
import PageLayout from "../components/PageLayout.jsx";
import TenantProvisioningForm from "../components/TenantProvisioningForm.jsx";
import { getAccessTokenFromServiceAccount, GOOGLE_CLOUD_SCOPES } from "../utils/deployGoogleAuth.js";
import { fetchJobExecutionLogs } from "../utils/deployLogs.js";
import { triggerDeploy, getJob, getJobStatus, fetchProviderHealth } from "../utils/api.js";

const defaultGithubToken =
  import.meta.env.VITE_GITHUB_TOKEN ||
  (typeof window !== "undefined" && window.__UNIFIED_UI_CONFIG__?.githubToken) ||
  "";

// ----- Default configuration -----
const defaultConfig = {
  github_token: defaultGithubToken,
  region: "us-central1",
  repo_url: "",
  branch: "",
  commit_sha: "",
  connectDatabase: false,
  database_instance: "",
  database_name: "",
  db_username: "app_user",
  db_password: "ReplaceThisPassword!",
  superuser_username: "postgres",
  superuser_password: "ReplaceThisSuperPassword!",
  init_script_path: "sql/init.sql",
  service_name: "",
  extra_env: [],
  extra_env_source: null,
  buckets: [],
  bucket_mounts: [],
  rawBuckets: "",
};

// ----- Validation & Helper Functions (ellipsis for brevity) -----
function validateBucketName(name) {
  if (!name) return "Bucket name cannot be empty.";
  if (name.length < 3 || name.length > 63)
    return "Bucket name must be between 3 and 63 characters.";
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name))
    return "Bucket name must start and end with a letter or number and can contain only lowercase letters, numbers, dots, and dashes.";
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(name))
    return "Bucket name cannot be formatted as an IP address.";
  return null;
}
function validateDatabaseInstanceName(name) {
  if (!name) return "Database instance name cannot be empty.";
  if (!/^[a-z][a-z0-9-]{0,97}$/.test(name))
    return "Instance name must start with a letter and contain only lowercase letters, numbers, and dashes (max 98 characters).";
  return null;
}
function validateDatabaseName(name) {
  if (!name) return "Database name cannot be empty.";
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))
    return "Database name must start with a letter and contain only letters, numbers, and underscores (max 64 characters).";
  return null;
}
function validateServiceName(name) {
  if (!name) return "Service name cannot be empty.";
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(name))
    return "Service name must start with a letter and contain only lowercase letters, numbers, and dashes (2-63 characters).";
  return null;
}
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
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    return window.atob(base64Text);
  }
  if (typeof atob === 'function') {
    return atob(base64Text);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64Text, 'base64').toString('utf-8');
  }
  throw new Error('Unable to decode base64 content in this environment.');
};
const BUCKET_API_URL = "https://storage.googleapis.com/storage/v1/b";
async function checkBucketAvailability(bucketName, serviceAccount) {
  let token;
  try { token = await getAccessTokenFromServiceAccount(serviceAccount, GOOGLE_CLOUD_SCOPES.STORAGE_READ_ONLY); }
  catch (error) { console.error("Error generating token for buckets:", error); return { status: "error", message: "Failed to generate access token for bucket check." }; }
  try {
    const response = await fetch(`${BUCKET_API_URL}/${bucketName}`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 200) { return { status: "owned", message: `Bucket ${bucketName} exists and is available.` }; }
    if (response.status === 404) { return { status: "available", message: `Bucket ${bucketName} does not exist (will be created).` }; }
    return { status: "error", message: `Unexpected error (status ${response.status}).` };
  } catch (error) { console.error("Bucket validation error:", error); return { status: "error", message: "Failed to validate bucket name." }; }
}
const SQLADMIN_BASE_URL = "https://sqladmin.googleapis.com/sql/v1beta4";
// Use the backend proxy to the agent catalog to avoid CORS/HTML fallbacks in Cloud Run.
const AGENT_REGISTRY_BASE_URL = "/api/agent-catalog";
async function checkCloudSqlInstanceAndDb(projectId, instanceName, dbName, serviceAccount) {
  let token;
  try { token = await getAccessTokenFromServiceAccount(serviceAccount, GOOGLE_CLOUD_SCOPES.CLOUD_PLATFORM); }
  catch (error) { console.error("Error generating token for Cloud SQL:", error); return { instanceMsg: "Failed to generate token for Cloud SQL check.", dbMsg: "" }; }
  const instanceUrl = `${SQLADMIN_BASE_URL}/projects/${projectId}/instances/${instanceName}`;
  let instanceMsg = ""; let instanceExists = false;
  try {
    const resp = await fetch(instanceUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 200) { instanceMsg = `Instance '${instanceName}' found.`; instanceExists = true; }
    else if (resp.status === 404) { instanceMsg = `Instance '${instanceName}' not found (will be created).`; }
    else if (resp.status === 403) { instanceMsg = `403: Insufficient permission to check instance '${instanceName}'.`; }
    else { instanceMsg = `Unexpected error (status ${resp.status}) checking instance.`; }
  } catch (error) { console.error("Error checking Cloud SQL instance:", error); instanceMsg = "Error while checking instance (network or token issue)."; }
  let dbMsg = "";
  if (instanceExists && dbName) {
    const dbUrl = `${SQLADMIN_BASE_URL}/projects/${projectId}/instances/${instanceName}/databases/${dbName}`;
    try {
      const dbResp = await fetch(dbUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (dbResp.status === 200) { dbMsg = `Database '${dbName}' found in instance '${instanceName}'.`; }
      else if (dbResp.status === 404) { dbMsg = `Database '${dbName}' not found (will be created).`; }
      else if (dbResp.status === 403) { dbMsg = `403: Insufficient permission to check database '${dbName}'.`; }
      else { dbMsg = `Unexpected error (status ${dbResp.status}) checking database.`; }
    } catch (error) { console.error("Error checking Cloud SQL database:", error); dbMsg = "Error while checking database (network or token issue)."; }
  }
  return { instanceMsg, dbMsg };
}

const POLLING_INTERVAL = 10000; // 10 seconds
const WAVES = [1, 2, 3];

// Helper to determine if a status is terminal (no more polling needed)
const isTerminalStatus = (status) => {
  if (!status) return false;
  return status.startsWith('success_') || status.startsWith('error_') || status.includes('failed') || status.includes('completed_');
};


const DescriptiveField = ({ name, label, tooltipTitle, children, ...props }) => (
  <Box display="flex" alignItems="center" width="100%">
    <TextField name={name} label={label} {...props} sx={{ flexGrow: 1, "& .MuiInputBase-input": { color: "#000" } }} InputLabelProps={{ sx: { color: "#555" } }} />
    {tooltipTitle && (
      <Tooltip title={tooltipTitle} placement="right">
        <IconButton size="small" sx={{ ml: 0.5 }}>
          <HelpOutline fontSize="small" />
        </IconButton>
      </Tooltip>
    )}
    {children}
  </Box>
);

DescriptiveField.propTypes = {
  name: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  tooltipTitle: PropTypes.string,
  children: PropTypes.node,
};


export default function ThunderdeployPage() {
  const location = useLocation();
  const [agentList, setAgentList] = useState([]);
  const [branchOptions, setBranchOptions] = useState({});
  const [agentBranchLoading, setAgentBranchLoading] = useState({});
  const [deploymentInstances, setDeploymentInstances] = useState([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState(null);
  const [selectedAgentForInstanceCreation, setSelectedAgentForInstanceCreation] = useState(null);
  const [newBranchSelection, setNewBranchSelection] = useState('');
  const [newInstanceDeploymentId, setNewInstanceDeploymentId] = useState('');
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [finalJSON, setFinalJSON] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [deploymentMessage, setDeploymentMessage] = useState(""); // For deployment job feedback
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState(""); // For general feedback (script copy/download, agent catalog fetch)
  const [selectedForFinalDeployment, setSelectedForFinalDeployment] = useState([]);
  const [isFetchingAgents, setIsFetchingAgents] = useState(false);
  const [gcpSetupScriptContent, setGcpSetupScriptContent] = useState("");
  const [isTenantsView, setIsTenantsView] = useState(false);
  const [pendingWave, setPendingWave] = useState(1);
  const [creationDialogOpen, setCreationDialogOpen] = useState(false);
  const [draggingAgent, setDraggingAgent] = useState(null);
  const [draggingInstance, setDraggingInstance] = useState(null);
  const [waveDeploying, setWaveDeploying] = useState(false);
  const [providerHealth, setProviderHealth] = useState(null);
  const [providerHealthLoading, setProviderHealthLoading] = useState(false);
  const [providerHealthError, setProviderHealthError] = useState("");

  const sourceCredentialStore = useCredentialStore('source');
  const targetCredentialStore = useCredentialStore('target');

  const activeSourceCredential = useMemo(
    () => sourceCredentialStore.entries.find((entry) => entry.id === sourceCredentialStore.selectedId) ?? null,
    [sourceCredentialStore.entries, sourceCredentialStore.selectedId],
  );
  const activeTargetCredential = useMemo(
    () => targetCredentialStore.entries.find((entry) => entry.id === targetCredentialStore.selectedId) ?? null,
    [targetCredentialStore.entries, targetCredentialStore.selectedId],
  );

  const globalServiceAccountFile = activeSourceCredential?.credential ?? null;
  const globalCustomerServiceAccountFile = activeTargetCredential?.credential ?? null;
  const isLoadingGlobalCredentials = sourceCredentialStore.loading || targetCredentialStore.loading;
  const hasActiveSourceCredential = Boolean(activeSourceCredential);
  const hasActiveTargetCredential = Boolean(activeTargetCredential);
  const canDeploy = hasActiveSourceCredential && hasActiveTargetCredential;

  const pollingIntervalsRef = useRef({});
  const deploymentInstancesRef = useRef([]);

  const waveGroups = useMemo(() => {
    const groups = {};
    WAVES.forEach((wave) => {
      groups[wave] = [];
    });
    deploymentInstances.forEach((inst) => {
      const waveId = WAVES.includes(Number(inst.wave)) ? Number(inst.wave) : 1;
      groups[waveId] = groups[waveId] ? [...groups[waveId], { ...inst, wave: waveId }] : [{ ...inst, wave: waveId }];
    });
    return groups;
  }, [deploymentInstances]);

  const convertJobRecordToInstance = useCallback((jobRecord) => {
    if (!jobRecord || typeof jobRecord !== "object") {
      return null;
    }

    const metadata = jobRecord.metadata;
    if (!metadata || typeof metadata !== "object") {
      return null;
    }

    const resolveAgentEntry = (candidate) => {
      if (!candidate || typeof candidate !== "object") {
        return null;
      }
      if (candidate.name && candidate.environment) {
        return candidate;
      }
      if (Array.isArray(candidate.agents) && candidate.agents.length > 0) {
        const firstAgent = candidate.agents[0];
        if (firstAgent && firstAgent.name && firstAgent.environment) {
          return firstAgent;
        }
      }
      return null;
    };

    let agentEntry = resolveAgentEntry(metadata.config);

    if (!agentEntry && metadata.config_b64) {
      try {
        const decoded = decodeBase64Content(metadata.config_b64);
        const parsed = JSON.parse(decoded);
        agentEntry = resolveAgentEntry(parsed) || resolveAgentEntry(parsed?.agents?.[0]);
      } catch (error) {
        console.error("Failed to parse stored deployment config payload", error);
      }
    }

    if (!agentEntry) {
      return null;
    }

    const environment =
      agentEntry.environment && typeof agentEntry.environment === "object"
        ? agentEntry.environment
        : {};

    const extraEnvRaw = environment.extra_env;
    let extraEnvEntries = [];
    if (Array.isArray(extraEnvRaw)) {
      extraEnvEntries = extraEnvRaw;
    } else if (extraEnvRaw && typeof extraEnvRaw === "object") {
      extraEnvEntries = Object.entries(extraEnvRaw).map(([key, value]) => ({
        key,
        value,
        matchesExample: false,
      }));
    }

    // Store deployed env vars as a source
    const deployedEnvSource = extraEnvEntries.length > 0 ? {
      name: 'deployed',
      label: 'Deployed Config',
      envVars: cloneEnvVarArray(extraEnvEntries)
    } : null;

    const bucketsArray = Array.isArray(environment.buckets)
      ? environment.buckets
      : typeof environment.buckets === "string"
        ? environment.buckets
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
        : [];

    const bucketMountsArray = Array.isArray(environment.bucket_mounts)
      ? environment.bucket_mounts
      : [];

    const baseConfig = {
      ...JSON.parse(JSON.stringify(defaultConfig)),
      ...environment,
      extra_env: cloneEnvVarArray(extraEnvEntries),
      buckets: bucketsArray,
      bucket_mounts: bucketMountsArray,
      rawBuckets: bucketsArray.join(", "),
    };

    if (environment.extra_env_source) {
      baseConfig.extra_env_source = environment.extra_env_source;
    }

    const repoUrl = baseConfig.repo_url || jobRecord.repo_url || "";
    const repoNameCandidate =
      jobRecord.repo_name ||
      agentEntry.name ||
      (repoUrl ? repoUrl.split("/").pop().replace(/\.git$/, "") : null) ||
      "Agent";

    const branchValue =
      baseConfig.branch ||
      environment.branch ||
      jobRecord.repo_branch ||
      jobRecord.branch ||
      "";

    const commitValue =
      baseConfig.commit_sha ||
      environment.commit_sha ||
      jobRecord.repo_commit ||
      jobRecord.commit_sha ||
      "";

    const instanceId =
      agentEntry.name ||
      jobRecord.instance_id ||
      jobRecord.service_name ||
      `${repoNameCandidate}-${Date.now()}`;

    return {
      id: instanceId,
      repoName: repoNameCandidate,
      branch: branchValue,
      commitSha: commitValue,
      wave: 1,
      config: baseConfig,
      envLoading: false,
      lastFetchedEnvBranch: branchValue || null,
      availableEnvSources: deployedEnvSource ? [deployedEnvSource] : [],
      selectedEnvSource: deployedEnvSource ? 'deployed' : (baseConfig.extra_env_source || null),
      exampleEnvDefaults: {},
      deployedEnvSource: deployedEnvSource,
      deploymentStatus: null,
      deploymentLog: null,
      jobLogEntries: null,
      deployedUrl: null,
      deploymentError: null,
      job_execution_name: null,
      job_project_id: null,
      job_region: null,
      job_name: null,
    };
  }, []);

  const applyJobConfigFromRecord = useCallback(
    (jobRecord, jobKeyLabel) => {
      const instance = convertJobRecordToInstance(jobRecord);
      if (!instance) {
        return false;
      }

      setDeploymentInstances((prev) => {
        const filtered = prev.filter((inst) => inst.id !== instance.id);
        return [...filtered, instance];
      });
      setSelectedInstanceId(instance.id);
      setSelectedForFinalDeployment((prev) => {
        const existing = new Set(Array.isArray(prev) ? prev : []);
        existing.add(instance.id);
        return Array.from(existing);
      });
      setSnackbarMessage(
        jobKeyLabel
          ? `Loaded deployment configuration from ${jobKeyLabel}.`
          : "Loaded deployment configuration from previous deployment."
      );
      setSnackbarOpen(true);
      return true;
    },
    [convertJobRecordToInstance, setDeploymentInstances, setSelectedInstanceId, setSelectedForFinalDeployment, setSnackbarMessage, setSnackbarOpen],
  );

  const retrieveJobLogs = useCallback(
    async ({ instance, jobExecutionStatus }) => {
      if (!globalServiceAccountFile) {
        return null;
      }
      if (!instance || !instance.job_execution_name || !instance.job_project_id) {
        return null;
      }

      return fetchJobExecutionLogs({
        // Job executions run inside the source (deployment) project,
        // so we need the source credential to read their Cloud Logging entries.
        serviceAccount: globalServiceAccountFile,
        projectId: instance.job_project_id,
        executionName: instance.job_execution_name,
        jobName: instance.job_name,
        region: instance.job_region,
        jobSucceeded: String(jobExecutionStatus || '').toUpperCase() === 'SUCCEEDED',
      });
    },
    [globalServiceAccountFile],
  );

  useEffect(() => {
    fetch('/setup_gcp_sa.sh')
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok for setup script');
        }
        return response.text();
      })
      .then(text => setGcpSetupScriptContent(text))
      .catch(error => {
        console.error('Failed to fetch GCP setup script:', error);
        setSnackbarMessage("Failed to load GCP setup script.");
        setSnackbarOpen(true);
      });
  }, []);

  const fetchAgentList = useCallback(async () => {
    setIsFetchingAgents(true);
    try {
      const response = await fetch(`${AGENT_REGISTRY_BASE_URL}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      setAgentList(agents);
    } catch (error) {
      console.error("Error fetching agent catalog:", error);
      setSnackbarMessage("Error fetching agent catalog.");
      setSnackbarOpen(true);
    } finally {
      setIsFetchingAgents(false);
    }
  }, []);

  useEffect(() => {
    fetchAgentList();
  }, [fetchAgentList]);

  useEffect(() => {
    if (!isTenantsView) return;
    setProviderHealthLoading(true);
    setProviderHealthError("");
    fetchProviderHealth()
      .then((data) => {
        setProviderHealth(data);
      })
      .catch((err) => {
        console.error("Failed to fetch provider health:", err);
        setProviderHealthError(err.message || "Failed to load provider health.");
      })
      .finally(() => {
        setProviderHealthLoading(false);
      });
  }, [isTenantsView, sourceCredentialStore.selectedId, targetCredentialStore.selectedId]);

  useEffect(() => {
    deploymentInstancesRef.current = deploymentInstances;
  }, [deploymentInstances]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const reuseJobKey = params.get("reuseJob");

    if (!reuseJobKey) {
      return;
    }

    let cancelled = false;

    const fetchJobConfig = async () => {
      try {
        const jobRecord = await getJob(reuseJobKey);
        if (cancelled) {
          return;
        }
        const applied = applyJobConfigFromRecord(jobRecord, reuseJobKey);
        if (!applied) {
          setSnackbarMessage("No reusable configuration found for the selected deployment.");
          setSnackbarOpen(true);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load deployment configuration", error);
        setSnackbarMessage(
          error instanceof Error
            ? `Failed to load deployment configuration: ${error.message}`
            : "Failed to load deployment configuration."
        );
        setSnackbarOpen(true);
      }
    };

    fetchJobConfig();

    return () => {
      cancelled = true;
    };
  }, [location.search, applyJobConfigFromRecord, setSnackbarMessage, setSnackbarOpen]);


  useEffect(() => {
    if (selectedAgentForInstanceCreation) {
      const agentName = selectedAgentForInstanceCreation;
      if (!branchOptions[agentName] && !agentBranchLoading[agentName]) {
        setAgentBranchLoading(prev => ({ ...prev, [agentName]: true }));
        const agentObj = agentList.find((r) => r.name === agentName);
        if (agentObj && agentObj.url) {
          const cleaned = agentObj.url.replace(/\.git$/, "");
          const parts = cleaned.split("/");
          if (parts.length < 5) {
            console.error(`Agent repository URL format unexpected: ${agentObj.url}`);
            setAgentBranchLoading(prev => ({ ...prev, [agentName]: false }));
            return;
          }
          const owner = parts[3];
          const repo = parts[4];
          const tokenToUse = defaultConfig.github_token;
          if (!tokenToUse) {
            console.warn("GitHub token missing; skipping branch fetch to avoid rate limits.");
            setSnackbarMessage("GitHub token missing. Set VITE_GITHUB_TOKEN (frontend) or provide githubToken in __UNIFIED_UI_CONFIG__.");
            setSnackbarOpen(true);
            setBranchOptions((prev) => ({ ...prev, [agentName]: [] }));
            setAgentBranchLoading(prev => ({ ...prev, [agentName]: false }));
            return;
          }
          fetch(`https://api.github.com/repos/${owner}/${repo}/branches`, {
            headers: tokenToUse ? { Authorization: `token ${tokenToUse}` } : {},
          })
            .then((response) => response.json())
            .then((data) => {
              const branches = Array.isArray(data) ? data.map(b => ({ name: b.name, commitSha: b.commit.sha })) : [];
              setBranchOptions((prev) => ({ ...prev, [agentName]: branches }));
              if (branches.length > 0) {
                setNewBranchSelection(branches[0].name);
                setNewInstanceDeploymentId(`${agentName}-${branches[0].name}`);
              } else {
                setNewBranchSelection('');
                setNewInstanceDeploymentId('');
              }
            })
            .catch((error) => console.error("Error fetching branches for agent:", agentName, error))
            .finally(() => setAgentBranchLoading(prev => ({ ...prev, [agentName]: false })));
        } else {
          setAgentBranchLoading(prev => ({ ...prev, [agentName]: false }));
        }
      } else if (branchOptions[agentName] && branchOptions[agentName].length > 0 && !newBranchSelection) {
        setNewBranchSelection(branchOptions[agentName][0].name);
        setNewInstanceDeploymentId(`${agentName}-${branchOptions[agentName][0].name}`);
      }
    }
  }, [selectedAgentForInstanceCreation, agentList, branchOptions, agentBranchLoading, newBranchSelection]);

  useEffect(() => {
    if (!selectedInstanceId) return;

    const instance = deploymentInstances.find(inst => inst.id === selectedInstanceId);
    if (!instance || !instance.branch) return;

    const shouldFetchEnv =
      (instance.branch !== instance.lastFetchedEnvBranch) &&
      !instance.envLoading;

    if (!shouldFetchEnv) return;

    const githubToken = instance?.config?.github_token || defaultConfig.github_token;
    if (!githubToken) {
      console.warn(`GitHub token missing; skipping env fetch for ${instance.id} to avoid rate limits.`);
      setDeploymentInstances(prev => prev.map(targetInst => targetInst.id === selectedInstanceId
        ? {
          ...targetInst,
          envLoading: false,
          availableEnvSources: targetInst.deployedEnvSource ? [targetInst.deployedEnvSource] : [],
          selectedEnvSource: targetInst.deployedEnvSource ? 'deployed' : null,
          exampleEnvDefaults: {},
          config: {
            ...(targetInst.config || {}),
            extra_env: targetInst.deployedEnvSource ? targetInst.deployedEnvSource.envVars : [],
            extra_env_source: targetInst.deployedEnvSource ? 'deployed' : null,
          },
        }
        : targetInst));
      setSnackbarMessage("GitHub token missing. Set VITE_GITHUB_TOKEN (frontend) or provide githubToken in __UNIFIED_UI_CONFIG__.");
      setSnackbarOpen(true);
      return;
    }

    setDeploymentInstances(prev => prev.map(inst =>
      inst.id === selectedInstanceId ? { ...inst, envLoading: true } : inst
    ));

    const agentEntry = agentList.find((r) => r.name === instance.repoName);
    if (!agentEntry || !agentEntry.url) {
      setDeploymentInstances(prev => prev.map(inst =>
        inst.id === selectedInstanceId
          ? {
            ...inst,
            envLoading: false,
            availableEnvSources: [],
            selectedEnvSource: null,
            exampleEnvDefaults: {},
            config: { ...inst.config, extra_env: [], extra_env_source: null },
          }
          : inst
      ));
      return;
    }

    const cleaned = agentEntry.url.replace(/\.git$/, "");
    const parts = cleaned.split("/");
    if (parts.length < 5) {
      console.error(`Agent repository URL format unexpected: ${agentEntry.url}`);
      setDeploymentInstances(prev => prev.map(inst =>
        inst.id === selectedInstanceId
          ? {
            ...inst,
            envLoading: false,
            availableEnvSources: [],
            selectedEnvSource: null,
            exampleEnvDefaults: {},
            config: { ...inst.config, extra_env: [], extra_env_source: null },
          }
          : inst
      ));
      return;
    }

    const owner = parts[3];
    const repoNameFromUrl = parts[4];
    const baseUrl = `https://api.github.com/repos/${owner}/${repoNameFromUrl}/contents`;
    const headers = githubToken ? { Authorization: `token ${githubToken}` } : {};

    const fetchEnvFile = async (fileName) => {
      const response = await fetch(`${baseUrl}/${fileName}?ref=${instance.branch}`, { headers });
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

    const loadEnvSources = async () => {
      let envResult = { found: false, content: null };
      let exampleResult = { found: false, content: null };
      try {
        envResult = await fetchEnvFile('.env');
      } catch (error) {
        console.error(`Error fetching .env for ${instance.id}:`, error);
      }

      try {
        exampleResult = await fetchEnvFile('.env.example');
      } catch (error) {
        console.error(`Error fetching .env.example for ${instance.id}:`, error);
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

      // Build sources list starting with deployed config (if it exists)
      const envSources = [];

      // Add deployed config first (if available)
      if (instance.deployedEnvSource) {
        envSources.push(instance.deployedEnvSource);
      }

      // Add .env if found
      if (envResult.found) {
        envSources.push({ name: '.env', label: '.env', envVars: cloneEnvVarArray(envArray) });
      }

      // Add .env.example if found
      if (exampleResult.found) {
        envSources.push({ name: '.env.example', label: '.env.example', envVars: cloneEnvVarArray(exampleEnvArray) });
      }

      // Determine selected source - prefer deployed, then .env, then .env.example
      let selectedSourceName = instance.selectedEnvSource || null;
      if (!selectedSourceName || !envSources.find(src => src.name === selectedSourceName)) {
        if (instance.deployedEnvSource) {
          selectedSourceName = 'deployed';
        } else if (envResult.found) {
          selectedSourceName = '.env';
        } else if (exampleResult.found) {
          selectedSourceName = '.env.example';
        }
      }

      const selectedEnvVars = selectedSourceName
        ? cloneEnvVarArray((envSources.find(src => src.name === selectedSourceName)?.envVars) || [])
        : [];

      setDeploymentInstances(prev => prev.map(targetInst => {
        if (targetInst.id !== selectedInstanceId) return targetInst;
        const currentConfig = targetInst.config || {};
        return {
          ...targetInst,
          envLoading: false,
          lastFetchedEnvBranch: targetInst.branch,
          availableEnvSources: envSources,
          selectedEnvSource: selectedSourceName,
          exampleEnvDefaults: Object.fromEntries(exampleDefaultsMap),
          deployedEnvSource: targetInst.deployedEnvSource,
          config: {
            ...currentConfig,
            extra_env: selectedEnvVars,
            extra_env_source: selectedSourceName,
          },
        };
      }));

      if (!envResult.found && !exampleResult.found && !instance.deployedEnvSource) {
        setSnackbarMessage(`No .env, .env.example, or deployed config found for ${instance.id}.`);
        setSnackbarOpen(true);
        // Ensure we mark this branch as fetched so we don't loop
        setDeploymentInstances(prev => prev.map(targetInst => {
          if (targetInst.id !== selectedInstanceId) return targetInst;
          return {
            ...targetInst,
            envLoading: false,
            lastFetchedEnvBranch: targetInst.branch,
          };
        }));
      } else if (instance.deployedEnvSource) {
        const additionalSources = envSources.length - 1;
        setSnackbarMessage(`Loaded deployed config for ${instance.id}.${additionalSources > 0 ? ` ${additionalSources} additional source(s) available.` : ''}`);
        setSnackbarOpen(true);
      } else if (!envResult.found && exampleResult.found) {
        setSnackbarMessage(`Loaded environment variables from .env.example for ${instance.id}.`);
        setSnackbarOpen(true);
      }
    };

    loadEnvSources().catch(error => {
      console.error(`Unexpected error while loading env sources for ${instance.id}:`, error);
      setDeploymentInstances(prev => prev.map(targetInst => {
        if (targetInst.id !== selectedInstanceId) {
          return targetInst;
        }

        // Keep deployed config even if GitHub fetch fails
        const sourcesToKeep = targetInst.deployedEnvSource
          ? [targetInst.deployedEnvSource]
          : [];

        return {
          ...targetInst,
          envLoading: false,
          lastFetchedEnvBranch: targetInst.branch,
          availableEnvSources: sourcesToKeep,
          selectedEnvSource: targetInst.deployedEnvSource ? 'deployed' : null,
          exampleEnvDefaults: {},
          deployedEnvSource: targetInst.deployedEnvSource,
          config: {
            ...targetInst.config,
            extra_env: targetInst.deployedEnvSource ? targetInst.deployedEnvSource.envVars : [],
            extra_env_source: targetInst.deployedEnvSource ? 'deployed' : null
          },
        };
      }));

      const message = instance.deployedEnvSource
        ? `Failed to load .env files for ${instance.id}, but deployed config is available.`
        : `Failed to load environment variables for ${instance.id}.`;
      setSnackbarMessage(message);
      setSnackbarOpen(true);
    });
  }, [selectedInstanceId, deploymentInstances, agentList]);


  // Polling useEffect
  useEffect(() => {
    const activeIds = new Set();
    deploymentInstances.forEach(instance => {
      if (!instance?.id) {
        return;
      }
      activeIds.add(instance.id);
      if (instance.job_execution_name && !isTerminalStatus(instance.deploymentStatus)) {
        if (!pollingIntervalsRef.current[instance.id]) {
          console.log(`Starting polling for ${instance.id} (Exec: ${instance.job_execution_name})`);
          const intervalId = setInterval(async () => {
            console.log(`Polling status for ${instance.id} (Exec: ${instance.job_execution_name})`);
            try {
              if (!instance.job_project_id || !instance.job_region || !instance.job_name) {
                console.warn(`Missing job_project_id, job_region, or job_name for instance ${instance.id}. Cannot poll.`);
                setDeploymentInstances(prev => prev.map(inst =>
                  inst.id === instance.id ? { ...inst, deploymentStatus: 'error_polling_misconfigured', deploymentError: 'Missing project/region/job_name for polling.' } : inst
                ));
                clearInterval(pollingIntervalsRef.current[instance.id]);
                delete pollingIntervalsRef.current[instance.id];
                return;
              }

              const statusData = await getJobStatus(
                instance.job_project_id,
                instance.job_region,
                instance.job_name,
                instance.job_execution_name,
              );
              const responseStatus = statusData.deployment_outcome || `job_${statusData.job_execution_status?.toLowerCase() || 'unknown'}`;

              let logResult = null;
              if (isTerminalStatus(responseStatus)) {
                try {
                  logResult = await retrieveJobLogs({
                    instance,
                    jobExecutionStatus: statusData.job_execution_status,
                  });
                } catch (logError) {
                  console.error(`Failed to fetch job logs for ${instance.id}`, logError);
                  logResult = { error: logError };
                }
              }

              setDeploymentInstances(prev => prev.map(inst => {
                if (inst.id !== instance.id) {
                  return inst;
                }

                let resolvedStatus = responseStatus;
                if (logResult && logResult.deploymentOutcome) {
                  resolvedStatus = logResult.deploymentOutcome;
                }

                if (isTerminalStatus(resolvedStatus) && pollingIntervalsRef.current[instance.id]) {
                  console.log(`Polling for ${instance.id} reached terminal state: ${resolvedStatus}. Stopping poll.`);
                  clearInterval(pollingIntervalsRef.current[instance.id]);
                  delete pollingIntervalsRef.current[instance.id];
                }

                const logLines = Array.isArray(logResult?.lines) && logResult.lines.length
                  ? logResult.lines
                  : null;
                const logText = logLines ? logLines.join('\n') : statusData.full_log || inst.deploymentLog;
                const logEntries = Array.isArray(logResult?.logs) && logResult.logs.length
                  ? logResult.logs
                  : inst.jobLogEntries;
                const logErrorMessage = logResult?.error
                  ? (logResult.error instanceof Error ? logResult.error.message : String(logResult.error))
                  : null;

                return {
                  ...inst,
                  deploymentStatus: resolvedStatus,
                  deployedUrl: logResult?.deployedServiceUrl || statusData.deployed_service_url || inst.deployedUrl,
                  deploymentError: logResult?.errorDetails || logErrorMessage || statusData.error_details || inst.deploymentError,
                  deploymentLog: logText,
                  jobLogEntries: logEntries || null,
                };
              }));

            } catch (error) {
              console.error(`Error polling status for ${instance.id}:`, error);
              setDeploymentInstances(prev => prev.map(inst =>
                inst.id === instance.id ? { ...inst, deploymentStatus: 'error_polling_failed', deploymentError: error.message } : inst
              ));
            }
          }, POLLING_INTERVAL);
          pollingIntervalsRef.current[instance.id] = intervalId;
        }
      } else if (instance.job_execution_name && isTerminalStatus(instance.deploymentStatus) && pollingIntervalsRef.current[instance.id]) {
        console.log(`Instance ${instance.id} is terminal, ensuring poll is stopped.`);
        clearInterval(pollingIntervalsRef.current[instance.id]);
        delete pollingIntervalsRef.current[instance.id];
      }
    });

    Object.keys(pollingIntervalsRef.current).forEach((trackedId) => {
      if (!activeIds.has(trackedId)) {
        console.log(`Removing stale polling interval for ${trackedId}`);
        clearInterval(pollingIntervalsRef.current[trackedId]);
        delete pollingIntervalsRef.current[trackedId];
      }
    });
  }, [deploymentInstances, retrieveJobLogs]);

  useEffect(() => {
    return () => {
      console.log("Cleaning up polling intervals (unmount).");
      Object.values(pollingIntervalsRef.current).forEach(clearInterval);
      pollingIntervalsRef.current = {};
    };
  }, []);


  const handleAddDeploymentInstance = (targetWave = pendingWave || 1) => {
    if (!selectedAgentForInstanceCreation || !newBranchSelection || !newInstanceDeploymentId.trim()) {
      alert("Please select an agent, a branch, and provide a unique Deployment ID.");
      return;
    }
    if (deploymentInstances.some(inst => inst.id === newInstanceDeploymentId.trim())) {
      alert(`Deployment ID "${newInstanceDeploymentId.trim()}" already exists. Please choose a unique ID.`);
      return;
    }

    const agentEntry = agentList.find(r => r.name === selectedAgentForInstanceCreation);
    if (!agentEntry) return;

    const branchInfoList = branchOptions[selectedAgentForInstanceCreation] || [];
    const selectedBranchInfo = branchInfoList.find((branch) => branch.name === newBranchSelection);
    const selectedCommitSha = selectedBranchInfo?.commitSha || '';

    const newInstance = {
      id: newInstanceDeploymentId.trim(),
      repoName: selectedAgentForInstanceCreation,
      branch: newBranchSelection,
      commitSha: selectedCommitSha,
      wave: targetWave,
      config: {
        ...JSON.parse(JSON.stringify(defaultConfig)),
        repo_url: agentEntry.url,
        branch: newBranchSelection,
        commit_sha: selectedCommitSha,
        service_name: `${selectedAgentForInstanceCreation.toLowerCase().replace(/[^a-z0-9-]/g, '')}-${newBranchSelection.toLowerCase().replace(/[^a-z0-9-]/g, '')}-svc`,
      },
      envLoading: false,
      lastFetchedEnvBranch: null,
      availableEnvSources: [],
      selectedEnvSource: null,
      exampleEnvDefaults: {},
      deploymentStatus: null,
      deploymentLog: null,
      jobLogEntries: null,
      deployedUrl: null,
      deploymentError: null,
      job_execution_name: null,
      job_project_id: null,
      job_region: null,
      job_name: null,
    };

    setDeploymentInstances(prev => [...prev, newInstance]);
    setSelectedInstanceId(newInstance.id);
    setSelectedAgentForInstanceCreation(null);
    setNewBranchSelection('');
    setNewInstanceDeploymentId('');
    setCreationDialogOpen(false);
  };

  const handleDeleteDeploymentInstance = (instanceIdToDelete) => {
    setDeploymentInstances(prev => prev.filter(inst => inst.id !== instanceIdToDelete));
    if (selectedInstanceId === instanceIdToDelete) {
      setSelectedInstanceId(null);
    }
    setSelectedForFinalDeployment(prev => prev.filter(id => id !== instanceIdToDelete));
    if (pollingIntervalsRef.current[instanceIdToDelete]) {
      clearInterval(pollingIntervalsRef.current[instanceIdToDelete]);
      delete pollingIntervalsRef.current[instanceIdToDelete];
    }
  };

  const handleInstanceConfigChange = (instanceId, field, value) => {
    setDeploymentInstances(prevInstances =>
      prevInstances.map(instance => {
        if (instance.id === instanceId) {
          const updatedConfig = {
            ...(instance.config || {}),
            [field]: value,
          };
          const nextInstance = { ...instance, config: updatedConfig };
          if (field === 'branch') {
            nextInstance.branch = value;
          }
          if (field === 'commit_sha') {
            nextInstance.commitSha = value;
          }
          return nextInstance;
        }
        return instance;
      })
    );
  };

  const handleInstanceConnectDatabaseToggle = (instanceId, checked) => {
    setDeploymentInstances(prevInstances =>
      prevInstances.map(instance => {
        if (instance.id === instanceId) {
          const currentConfig = instance.config || {};
          let updatedDbConfig = {};
          if (checked) {
            updatedDbConfig = {
              connectDatabase: true,
              database_instance: currentConfig.database_instance || `${instance.repoName.toLowerCase().replace(/[^a-z0-9-]/g, '')}-${instance.branch.toLowerCase().replace(/[^a-z0-9-]/g, '')}-db`,
              database_name: currentConfig.database_name || `${instance.repoName.toLowerCase().replace(/[^a-z0-9_]/g, '')}_${instance.branch.toLowerCase().replace(/[^a-z0-9_]/g, '')}_data`,
              db_username: currentConfig.db_username || "app_user",
              db_password: currentConfig.db_password || "ReplaceThisPassword!",
              superuser_username: currentConfig.superuser_username || "postgres",
              superuser_password: currentConfig.superuser_password || "ReplaceThisSuperPassword!",
              init_script_path: currentConfig.init_script_path || "sql/init.sql",
            };
          } else {
            updatedDbConfig = {
              connectDatabase: false,
              database_instance: "", database_name: "", db_username: "",
              db_password: "", superuser_username: "", superuser_password: "",
              init_script_path: "",
            };
          }
          return { ...instance, config: { ...currentConfig, ...updatedDbConfig } };
        }
        return instance;
      })
    );
  };

  const handleInstanceExtraEnvChange = (instanceId, index, field, value) => {
    setDeploymentInstances(prevInstances =>
      prevInstances.map(instance => {
        if (instance.id !== instanceId) return instance;
        const currentConfig = instance.config || {};
        const envVars = currentConfig.extra_env || [];
        const defaults = instance.exampleEnvDefaults || {};
        const updatedEnvVars = envVars.map((pair, i) => {
          if (i !== index) return pair;
          const updatedPair = { ...pair, [field]: value };
          const keyToCheck = field === 'key' ? value : updatedPair.key;
          const compareValue = field === 'value' ? value : updatedPair.value;
          if (keyToCheck && Object.prototype.hasOwnProperty.call(defaults, keyToCheck)) {
            updatedPair.matchesExample = defaults[keyToCheck] === compareValue;
          } else {
            updatedPair.matchesExample = false;
          }
          return updatedPair;
        });

        const resolvedSource = currentConfig.extra_env_source || instance.selectedEnvSource || null;

        return {
          ...instance,
          config: {
            ...currentConfig,
            extra_env: updatedEnvVars,
            extra_env_source: resolvedSource,
          },
        };
      })
    );
  };

  const addInstanceExtraEnvVar = (instanceId) => {
    setDeploymentInstances(prevInstances =>
      prevInstances.map(instance => {
        if (instance.id !== instanceId) return instance;
        const currentConfig = instance.config || {};
        const envVars = currentConfig.extra_env || [];
        const resolvedSource = currentConfig.extra_env_source || instance.selectedEnvSource || null;
        return {
          ...instance,
          config: {
            ...currentConfig,
            extra_env: [...envVars, { key: "NEW_VAR", value: "", matchesExample: false }],
            extra_env_source: resolvedSource,
          },
        };
      })
    );
  };

  const removeInstanceExtraEnvVar = (instanceId, index) => {
    setDeploymentInstances(prevInstances =>
      prevInstances.map(instance => {
        if (instance.id === instanceId) {
          const currentConfig = instance.config || {};
          const envVars = currentConfig.extra_env || [];
          const updatedEnvVars = envVars.filter((_, i) => i !== index);
          const resolvedSource = currentConfig.extra_env_source || instance.selectedEnvSource || null;
          return { ...instance, config: { ...currentConfig, extra_env: updatedEnvVars, extra_env_source: resolvedSource } };
        }
        return instance;
      })
    );
  };

  const handleEnvSourceSelection = (instanceId, sourceName) => {
    setDeploymentInstances(prevInstances =>
      prevInstances.map(instance => {
        if (instance.id !== instanceId) return instance;
        const envSources = instance.availableEnvSources || [];
        const selectedSource = envSources.find(src => src.name === sourceName);
        const defaults = instance.exampleEnvDefaults || {};
        const defaultsMap = new Map(Object.entries(defaults));
        const envVars = selectedSource ? cloneEnvVarArray(selectedSource.envVars || []) : [];
        const recalculatedVars = envVars.map(pair => {
          const defaultValue = defaultsMap.get(pair.key);
          return {
            ...pair,
            matchesExample: defaultValue !== undefined && defaultValue === pair.value,
          };
        });

        return {
          ...instance,
          selectedEnvSource: sourceName || null,
          config: {
            ...(instance.config || {}),
            extra_env: recalculatedVars,
            extra_env_source: sourceName || null,
          },
        };
      })
    );
  };

  const handleInstanceBucketsChange = (instanceId, value) => {
    handleInstanceConfigChange(instanceId, "rawBuckets", value);
  };

  const handleInstanceBucketsBlur = (instanceId, value) => {
    const bucketsArray = value.split(",").map((s) => s.trim()).filter(Boolean);
    setDeploymentInstances(prevInstances =>
      prevInstances.map(instance =>
        instance.id === instanceId
          ? { ...instance, config: { ...(instance.config || {}), buckets: bucketsArray } }
          : instance
      )
    );
  };

  const handleInstanceBucketMountChange = (instanceId, index, field, value) => {
    setDeploymentInstances(prevInstances =>
      prevInstances.map(instance => {
        if (instance.id === instanceId) {
          const currentConfig = instance.config || {};
          const mounts = currentConfig.bucket_mounts || [];
          const updatedMount = { ...mounts[index], [field]: value };
          const newMounts = [...mounts];
          newMounts[index] = updatedMount;
          return { ...instance, config: { ...currentConfig, bucket_mounts: newMounts } };
        }
        return instance;
      })
    );
  };

  const addInstanceBucketMount = (instanceId) => {
    setDeploymentInstances(prevInstances =>
      prevInstances.map(instance => {
        if (instance.id === instanceId) {
          const currentConfig = instance.config || {};
          const mounts = currentConfig.bucket_mounts || [];
          return { ...instance, config: { ...currentConfig, bucket_mounts: [...mounts, { bucket: "", mount_path: "" }] } };
        }
        return instance;
      })
    );
  };

  const removeInstanceBucketMount = (instanceId, index) => {
    setDeploymentInstances(prevInstances =>
      prevInstances.map(instance => {
        if (instance.id === instanceId) {
          const currentConfig = instance.config || {};
          const mounts = currentConfig.bucket_mounts || [];
          const newMounts = mounts.filter((_, i) => i !== index);
          return { ...instance, config: { ...currentConfig, bucket_mounts: newMounts } };
        }
        return instance;
      })
    );
  };

  const validateInstanceBuckets = async (instanceId) => {
    const instance = deploymentInstances.find(inst => inst.id === instanceId);
    if (!instance || !instance.config) return;
    const config = instance.config;
    if (!globalCustomerServiceAccountFile) {
      alert("Please upload the Target Project customer_serviceaccount.json for bucket validation.");
      return;
    }
    const messages = {};
    let hasBucketsToCheck = false;
    if (config.buckets && config.buckets.length > 0) {
      hasBucketsToCheck = true;
      for (const bucket of config.buckets) {
        const localError = validateBucketName(bucket);
        if (localError) {
          messages[bucket] = localError;
          continue;
        }
        const result = await checkBucketAvailability(bucket, globalCustomerServiceAccountFile);
        messages[bucket] = result.message;
      }
    }
    if (config.bucket_mounts && config.bucket_mounts.length > 0) {
      for (const mount of config.bucket_mounts) {
        if (mount.bucket) {
          hasBucketsToCheck = true;
          const localError = validateBucketName(mount.bucket);
          if (localError) {
            messages[mount.bucket] = `Mount Bucket: ${localError}`;
            continue;
          }
          if (!messages[mount.bucket]) {
            const result = await checkBucketAvailability(mount.bucket, globalCustomerServiceAccountFile);
            messages[mount.bucket] = `Mount Bucket: ${result.message}`;
          }
        }
      }
    }
    if (!hasBucketsToCheck) {
      alert("No buckets configured for this instance to validate.");
      return;
    }
    alert(`Bucket Validation for ${instance.id}:\n${JSON.stringify(messages, null, 2)}`);
  };

  const validateInstanceDatabase = async (instanceId) => {
    const instance = deploymentInstances.find(inst => inst.id === instanceId);
    if (!instance || !instance.config) return;
    const config = instance.config;
    if (!config.connectDatabase) {
      alert(`Database connection is not enabled for instance: ${instance.id}.`);
      return;
    }
    if (!globalCustomerServiceAccountFile) {
      alert("Please upload the Target Project customer_serviceaccount.json for DB validation.");
      return;
    }
    const projectId = globalCustomerServiceAccountFile.project_id;
    if (!projectId) {
      alert("Project ID not found in the customer_serviceaccount.json.");
      return;
    }
    const instanceName = config.database_instance;
    const dbName = config.database_name;
    const errors = [];
    const instErr = validateDatabaseInstanceName(instanceName);
    if (instErr) errors.push(`Instance Name: ${instErr}`);
    const dbErr = validateDatabaseName(dbName);
    if (dbErr) errors.push(`Database Name: ${dbErr}`);

    const svcErr = validateServiceName(config.service_name || instance.id);
    if (svcErr) errors.push(`Service Name (derived for context): ${svcErr}`);

    if (errors.length > 0) {
      alert(`Validation Errors for ${instance.id}:\n${errors.join("\n")}`);
      return;
    }
    const { instanceMsg, dbMsg } = await checkCloudSqlInstanceAndDb(
      projectId,
      instanceName,
      dbName,
      globalCustomerServiceAccountFile
    );
    alert(`DB Validation for ${instance.id}:\nInstance Check: ${instanceMsg}\nDatabase Check: ${dbMsg}`);
  };

  const generateFinalJSON = (instanceIdsOverride = null) => {
    const instanceIdsToUse = instanceIdsOverride ?? selectedForFinalDeployment;
    if (!instanceIdsToUse || instanceIdsToUse.length === 0) {
      alert("Please select at least one Deployment Configuration by checking its box.");
      setFinalJSON("");
      return "";
    }
    const finalAgents = instanceIdsToUse.map((instanceIdToDeploy) => {
      const instance = deploymentInstances.find(inst => inst.id === instanceIdToDeploy);
      if (!instance || !instance.config) return null;

      const config = instance.config;
      const extraEnvObj = {};
      if (config.extra_env && Array.isArray(config.extra_env)) {
        config.extra_env.forEach(({ key, value }) => {
          if (key) extraEnvObj[key] = value;
        });
      }

      const envSourceName = config.extra_env_source ?? instance.selectedEnvSource ?? null;

      const environment = {
        github_token: config.github_token,
        region: config.region,
        repo_url: config.repo_url,
        branch: instance.branch,
        commit_sha: config.commit_sha || instance.commitSha || null,
        connectDatabase: config.connectDatabase,
        service_name: config.service_name,
        extra_env_source: envSourceName,
        extra_env: extraEnvObj,
        buckets: config.buckets || [],
        bucket_mounts: config.bucket_mounts || [],
      };

      if (config.connectDatabase) {
        environment.database_instance = config.database_instance;
        environment.database_name = config.database_name;
        environment.db_username = config.db_username;
        environment.db_password = config.db_password;
        environment.superuser_username = config.superuser_username;
        environment.superuser_password = config.superuser_password;
        environment.init_script_path = config.init_script_path;
      }
      return { name: instance.id, commit_sha: environment.commit_sha, environment: environment };
    }).filter(Boolean);

    if (finalAgents.length === 0) {
      alert("No valid configurations found for selected deployments.");
      setFinalJSON("");
      return "";
    }

    const finalConfig = { agents: finalAgents, repositories: finalAgents };
    const jsonStr = JSON.stringify(finalConfig, null, 2);
    setFinalJSON(jsonStr);
    return jsonStr;
  };

  const triggerDeployment = async (instanceIdsOverride = null) => {
    const idsToDeploy = instanceIdsOverride ?? selectedForFinalDeployment;
    if (!idsToDeploy || idsToDeploy.length === 0) {
      alert("Select at least one deployment to run.");
      return;
    }
    const placeholderWarnings = idsToDeploy
      .map(instanceId => {
        const instance = deploymentInstances.find(inst => inst.id === instanceId);
        if (!instance || !instance.config || !Array.isArray(instance.config.extra_env)) return null;
        const flagged = instance.config.extra_env.filter(pair => pair.matchesExample && pair.key);
        if (!flagged.length) return null;
        return { instanceId, keys: flagged.map(pair => pair.key) };
      })
      .filter(Boolean);

    if (placeholderWarnings.length > 0) {
      const warningMessage = placeholderWarnings
        .map(({ instanceId, keys }) => `${instanceId}: ${keys.join(', ')}`)
        .join('\n');
      const proceed = window.confirm(
        `The following environment variables are still using example defaults:\n${warningMessage}\n\n` +
        `Update the values directly in the table or press OK to proceed anyway.`
      );
      if (!proceed) {
        return;
      }
    }

    const finalJsonStr = generateFinalJSON(idsToDeploy);
    if (!finalJsonStr) return;

    if (!globalServiceAccountFile || !globalCustomerServiceAccountFile) {
      const openManager = window.confirm('Active source and target credentials are required before deploying. Open the Credential Manager now?');
      if (openManager) {
        window.location.assign('/credentials');
      }
      return;
    }
    setDeploying(true);
    setDeploymentMessage("Submitting deployment jobs..."); // Use dedicated state for deployment job messages
    setSnackbarOpen(true);

    setDeploymentInstances(prev => prev.map(inst =>
      idsToDeploy.includes(inst.id)
        ? {
          ...inst,
          deploymentStatus: 'submitted_pending_status',
          deploymentLog: "Job submitted, waiting for execution details...",
          deployedUrl: null,
          deploymentError: null,
          job_execution_name: null,
          job_project_id: null,
          job_region: null,
          job_name: null,
        }
        : inst
    ));

    try {
      const userrequirements = JSON.parse(finalJsonStr);
      const responseData = await triggerDeploy({
        userrequirements,
        serviceaccount: globalServiceAccountFile,
        customer_serviceaccount: globalCustomerServiceAccountFile,
      });

      if (responseData.results && Array.isArray(responseData.results)) {
        setDeploymentInstances(prevInstances =>
          prevInstances.map(inst => {
            const result = responseData.results.find(r => r.instance_id === inst.id);
            if (result) {
              return {
                ...inst,
                deploymentStatus: result.status_overall_job_execution === 'submitted' ? 'submitted_pending_status' : result.status_overall_job_execution,
                deploymentLog: result.message,
                deploymentError: result.error_details,
                jobLogEntries: null,
                job_execution_name: result.job_execution_name,
                job_project_id: result.job_project_id,
                job_region: result.job_region,
                job_name: result.job_name,
              };
            }
            return inst;
          })
        );
        setDeploymentMessage("Deployment jobs submitted. Monitoring started.");
      } else {
        setDeploymentMessage(`Deployment submission response: ${JSON.stringify(responseData)}`);
      }

    } catch (error) {
      console.error("Error triggering deployment:", error);
      setDeploymentMessage(`Error triggering deployment: ${error.message}`);
      setDeploymentInstances(prev => prev.map(inst =>
        idsToDeploy.includes(inst.id)
          ? { ...inst, deploymentStatus: 'error_trigger_failed', deploymentError: error.message }
          : inst
      ));
    } finally {
      setDeploying(false);
      setSnackbarOpen(true);
    }
  };

  const waitForWaveCompletion = async (instanceIds) => {
    if (!instanceIds || instanceIds.length === 0) {
      return;
    }
    const timeoutMs = 30 * 60 * 1000;
    const start = Date.now();
    while (true) {
      const statuses = instanceIds.map((id) => deploymentInstancesRef.current.find((inst) => inst.id === id)?.deploymentStatus);
      const allDone = statuses.every((status) => isTerminalStatus(status));
      if (allDone) {
        return;
      }
      if (Date.now() - start > timeoutMs) {
        setDeploymentMessage("Wave deployment timed out while waiting for completion.");
        setSnackbarOpen(true);
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  };

  const deployWave = async (waveId) => {
    const waveInstances = waveGroups[waveId] || [];
    if (waveInstances.length === 0) {
      alert(`Wave ${waveId} has no deployments.`);
      return;
    }
    const ids = waveInstances.map((inst) => inst.id);
    const selectedIds = ids.filter((id) => selectedForFinalDeployment.includes(id));
    const idsToDeploy = selectedIds.length > 0 ? selectedIds : ids;
    setWaveDeploying(true);
    setDeploymentMessage(`Deploying wave ${waveId} (${idsToDeploy.length})...`);
    setSnackbarOpen(true);
    await triggerDeployment(idsToDeploy);
    setWaveDeploying(false);
  };

  const deployWavesSequentially = async () => {
    setWaveDeploying(true);
    for (const waveId of WAVES) {
      const waveInstances = waveGroups[waveId] || [];
      if (!waveInstances.length) continue;
      const ids = waveInstances.map((inst) => inst.id);
      const selectedIds = ids.filter((id) => selectedForFinalDeployment.includes(id));
      const idsToDeploy = selectedIds.length > 0 ? selectedIds : ids;
      setDeploymentMessage(`Deploying wave ${waveId} (${idsToDeploy.length})...`);
      setSnackbarOpen(true);
      // eslint-disable-next-line no-await-in-loop
      await triggerDeployment(idsToDeploy);
      // eslint-disable-next-line no-await-in-loop
      await waitForWaveCompletion(idsToDeploy);
    }
    setDeploymentMessage("Wave deployment sequence finished.");
    setSnackbarOpen(true);
    setWaveDeploying(false);
  };

  const assignInstanceToWave = (instanceId, waveId) => {
    setDeploymentInstances((prev) =>
      prev.map((inst) =>
        inst.id === instanceId ? { ...inst, wave: waveId } : inst
      )
    );
  };

  const handleWaveDrop = (waveId, event) => {
    event.preventDefault();
    const droppedAgent = event?.dataTransfer?.getData("text/agent") || draggingAgent;
    const droppedInstance = event?.dataTransfer?.getData("text/instance") || draggingInstance;
    if (droppedInstance) {
      assignInstanceToWave(droppedInstance, waveId);
      setDraggingInstance(null);
      return;
    }
    if (droppedAgent) {
      setPendingWave(waveId);
      setSelectedAgentForInstanceCreation(droppedAgent);
      setCreationDialogOpen(true);
      setDraggingAgent(null);
    }
  };

  const handleAgentDragStart = (agentName, event) => {
    if (event?.dataTransfer) {
      event.dataTransfer.setData("text/agent", agentName);
    }
    setDraggingAgent(agentName);
  };

  const handleInstanceDragStart = (instanceId, event) => {
    if (event?.dataTransfer) {
      event.dataTransfer.setData("text/instance", instanceId);
    }
    setDraggingInstance(instanceId);
  };




  const currentInstance = useMemo(() =>
    selectedInstanceId ? deploymentInstances.find(inst => inst.id === selectedInstanceId) : null
    , [selectedInstanceId, deploymentInstances]);
  const currentConfig = currentInstance ? currentInstance.config : null;

  const manualPollInstance = useCallback(async (instanceId) => {
    const instance = deploymentInstances.find(inst => inst.id === instanceId);
    if (!instance || !instance.job_execution_name || !instance.job_project_id || !instance.job_region || !instance.job_name) {
      console.warn(`Cannot manually poll instance ${instanceId}: missing execution details.`);
      setSnackbarMessage(`Cannot poll ${instanceId}: missing execution details (project, region, name, or exec name).`);
      setSnackbarOpen(true);
      return;
    }

    console.log(`Manually polling status for ${instance.id} (Exec: ${instance.job_execution_name})`);
    setDeploymentInstances(prev => prev.map(inst =>
      inst.id === instanceId ? { ...inst, deploymentStatus: 'polling_manual_check' } : inst
    ));

    try {
      const statusData = await getJobStatus(
        instance.job_project_id,
        instance.job_region,
        instance.job_name,
        instance.job_execution_name,
      );
      const responseStatus = statusData.deployment_outcome || `job_${statusData.job_execution_status?.toLowerCase() || 'unknown'}`;

      let logResult = null;
      if (isTerminalStatus(responseStatus)) {
        try {
          logResult = await retrieveJobLogs({
            instance,
            jobExecutionStatus: statusData.job_execution_status,
          });
        } catch (logError) {
          console.error(`Failed to fetch job logs for ${instance.id}`, logError);
          logResult = { error: logError };
        }
      }

      setDeploymentInstances(prev => prev.map(inst => {
        if (inst.id !== instance.id) {
          return inst;
        }

        let resolvedStatus = responseStatus;
        if (logResult && logResult.deploymentOutcome) {
          resolvedStatus = logResult.deploymentOutcome;
        }

        const logLines = Array.isArray(logResult?.lines) && logResult.lines.length
          ? logResult.lines
          : null;
        const logText = logLines ? logLines.join('\n') : statusData.full_log || inst.deploymentLog;
        const logEntries = Array.isArray(logResult?.logs) && logResult.logs.length
          ? logResult.logs
          : inst.jobLogEntries;
        const logErrorMessage = logResult?.error
          ? (logResult.error instanceof Error ? logResult.error.message : String(logResult.error))
          : null;

        return {
          ...inst,
          deploymentStatus: resolvedStatus,
          deployedUrl: logResult?.deployedServiceUrl || statusData.deployed_service_url || inst.deployedUrl,
          deploymentError: logResult?.errorDetails || logErrorMessage || statusData.error_details || inst.deploymentError,
          deploymentLog: logText,
          jobLogEntries: logEntries || null,
        };
      }));
      setSnackbarMessage(`Status updated for ${instance.id}.`);
      setSnackbarOpen(true);

    } catch (error) {
      console.error(`Error manually polling status for ${instance.id}:`, error);
      setDeploymentInstances(prev => prev.map(inst =>
        inst.id === instanceId ? { ...inst, deploymentStatus: 'error_polling_failed', deploymentError: error.message } : inst
      ));
      setSnackbarMessage(`Error updating status for ${instance.id}.`);
      setSnackbarOpen(true);
    }
  }, [deploymentInstances, retrieveJobLogs]);

  const handleSelectInstanceItem = useCallback((instanceId) => {
    setSelectedInstanceId(instanceId);
    setSelectedAgentForInstanceCreation(null);
  }, []);

  const handleToggleInstanceCheckbox = useCallback((instanceId) => {
    setSelectedForFinalDeployment(prevSelected =>
      prevSelected.includes(instanceId)
        ? prevSelected.filter(id => id !== instanceId)
        : [...prevSelected, instanceId]
    );
  }, []);

  const handleDownloadScript = () => {
    if (!gcpSetupScriptContent) {
      setSnackbarMessage("Setup script not loaded yet. Please try again shortly.");
      setSnackbarOpen(true);
      return;
    }
    const blob = new Blob([gcpSetupScriptContent], { type: 'text/bash' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'setup_gcp_sa.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSnackbarMessage("GCP setup script downloaded.");
    setSnackbarOpen(true);
  };

  const handleCopyScript = () => {
    if (!gcpSetupScriptContent) {
      setSnackbarMessage("Setup script not loaded yet. Please try again shortly.");
      setSnackbarOpen(true);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = gcpSetupScriptContent;
    textarea.style.position = 'fixed'; // Prevent scrolling to bottom
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      const successful = document.execCommand('copy');
      const msg = successful ? 'GCP setup script copied to clipboard!' : 'Failed to copy script.';
      setSnackbarMessage(msg);
    } catch (err) {
      setSnackbarMessage('Failed to copy script.');
      console.error('Fallback: Oops, unable to copy', err);
    }
    document.body.removeChild(textarea);
    setSnackbarOpen(true);
  };

  const renderProviderHealthAlert = () => {
    if (providerHealthLoading) {
      return <Alert severity="info">Checking provider setup…</Alert>;
    }
    if (providerHealthError) {
      return <Alert severity="warning">{providerHealthError}</Alert>;
    }
    if (!providerHealth) {
      return null;
    }

    const status = providerHealth.overall_status || "warning";
    const triggerservice = providerHealth.triggerservice || {};
    const source = providerHealth.source_credential || {};
    const target = providerHealth.target_credential || {};

    const blockingReasons = [];
    const warningReasons = [];

    if (!triggerservice.configured) {
      blockingReasons.push("TriggerService not configured");
    } else if (!triggerservice.reachable) {
      blockingReasons.push("TriggerService unreachable");
    }
    if (!source.selectedId) {
      blockingReasons.push("No source credential selected");
    } else if (!["primed", "verified"].includes((source.status || "").toLowerCase())) {
      warningReasons.push(`Source credential status: ${source.status || "unknown"}`);
    }
    if (!target.selectedId) {
      warningReasons.push("No target credential selected");
    } else if ((target.status || "").toLowerCase() !== "primed") {
      warningReasons.push(`Target credential status: ${target.status || "unknown"} (needs primed)`);
    }

    const severity = status === "error" ? "error" : status === "warning" ? "warning" : "success";
    const blockingText = blockingReasons.join("; ") || triggerservice.detail || "Unknown issue.";
    const warningText = [...blockingReasons, ...warningReasons].filter(Boolean).join("; ") || "Review provider setup.";
    const successText = `Provider setup looks good. TriggerService reachable; source ${source.selectedId || "n/a"}; target ${target.selectedId || "n/a"}.`;

    if (severity === "success") {
      return <Alert severity="success">{successText}</Alert>;
    }
    if (severity === "warning") {
      return <Alert severity="warning">Provider setup has warnings: {warningText}</Alert>;
    }
    return <Alert severity="error">Provider setup is blocking tenant provisioning: {blockingText}</Alert>;
  };


  const headerActions = (
    <>
      <Tooltip title="View recent jobs and live deployment outcomes." arrow placement="bottom">
        <Button
          component={RouterLink}
          to="/dashboard"
          variant="contained"
          color="primary"
          startIcon={<Launch fontSize="small" />}
        >
          Deployment Dashboard
        </Button>
      </Tooltip>
      <Tooltip title="Upload, activate, or clean up stored service account credentials." arrow placement="bottom">
        <Button
          component={RouterLink}
          to="/credentials"
          variant="contained"
          color="primary"
          startIcon={<VpnKey fontSize="small" />}
        >
          Credential Manager
        </Button>
      </Tooltip>
    </>
  );


  return (
    <>
      <PageLayout
        title="Agent deployment configurator"
        subtitle="Compose and manage Thunderdeploy agent runbooks across tenants and environments."
        actions={headerActions}
        maxWidth="xl"
        disableContainer
        containerSx={{ px: { xs: 0, md: 0 }, pb: 6 }}
      >
        <Stack spacing={3} sx={{ px: { xs: 2, md: 3 }, pb: 2 }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }} justifyContent="space-between">
            <Stack direction="row" spacing={1}>
              <Button variant={isTenantsView ? "outlined" : "contained"} onClick={() => setIsTenantsView(false)}>
                Deploy board
              </Button>
              <Button variant={isTenantsView ? "contained" : "outlined"} onClick={() => setIsTenantsView(true)}>
                Tenant provisioning
              </Button>
            </Stack>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Button
                variant="outlined"
                onClick={() => {
                  generateFinalJSON();
                  setJsonDialogOpen(true);
                }}
                disabled={selectedForFinalDeployment.length === 0}
              >
                Preview Deployment JSON
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={() => triggerDeployment()}
                disabled={deploying || selectedForFinalDeployment.length === 0 || !canDeploy}
              >
                {deploying ? <CircularProgress size={18} color="inherit" /> : `Deploy Selected (${selectedForFinalDeployment.length})`}
              </Button>
              <Button
                variant="contained"
                color="secondary"
                onClick={deployWavesSequentially}
                disabled={waveDeploying || !canDeploy || deploymentInstances.length === 0}
              >
                {waveDeploying ? <CircularProgress size={18} color="inherit" /> : "Deploy Waves In Order"}
              </Button>
            </Stack>
          </Stack>

          <Box sx={{ mb: 1 }}>
            {isLoadingGlobalCredentials ? (
              <Alert icon={<CircularProgress size={16} />} severity="info">
                Checking saved credentials…
              </Alert>
            ) : hasActiveSourceCredential && hasActiveTargetCredential ? (
              <Alert severity="success">
                <Stack spacing={1} alignItems="flex-start">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>Active source:</span>
                    <Chip color="success" size="small" label={activeSourceCredential?.label ?? "—"} />
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>Active target:</span>
                    <Chip color="success" size="small" label={activeTargetCredential?.label ?? "—"} />
                  </Stack>
                </Stack>
              </Alert>
            ) : (
              <Alert severity="warning">Choose an active source and target credential in the Credential Manager before deploying.</Alert>
            )}
          </Box>

          {isTenantsView ? (
            <Stack spacing={2}>
              {renderProviderHealthAlert()}
              <TenantProvisioningForm
                serviceAccount={globalServiceAccountFile}
                customerServiceAccount={globalCustomerServiceAccountFile}
                providerHealth={providerHealth}
              />
            </Stack>
          ) : (
            <>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "flex-start", md: "center" }} justifyContent="space-between">
                  <Box>
                    <Typography variant="h6">Agent catalog</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Drag an agent to a wave to create a deployment configuration.
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Tooltip title="Open Agent Catalog">
                      <IconButton
                        size="small"
                        href="https://thunderagents-497847265153.us-central1.run.app/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <LinkIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={isFetchingAgents ? <CircularProgress size={14} /> : <Refresh fontSize="small" />}
                      onClick={fetchAgentList}
                    >
                      Refresh agents
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<FileCopyIcon />} onClick={handleCopyScript} disabled={!gcpSetupScriptContent}>
                      Copy setup script
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownloadScript} disabled={!gcpSetupScriptContent}>
                      Download setup script
                    </Button>
                  </Stack>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
                  {agentList.map((agent) => (
                    <Chip
                      key={agent.name}
                      label={agent.name}
                      draggable
                      onDragStart={(e) => handleAgentDragStart(agent.name, e)}
                      onClick={() => {
                        setPendingWave(1);
                        setSelectedAgentForInstanceCreation(agent.name);
                        setCreationDialogOpen(true);
                      }}
                      sx={{ cursor: "grab" }}
                    />
                  ))}
                  {agentList.length === 0 && <Typography variant="body2">No agents available. Refresh the catalog.</Typography>}
                </Stack>
              </Paper>

              <Grid container spacing={2}>
                {WAVES.map((waveId) => {
                  const waveItems = waveGroups[waveId] || [];
                  return (
                    <Grid item xs={12} md={4} key={`wave-${waveId}`}>
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 2,
                          minHeight: 260,
                          borderStyle: "dashed",
                          borderColor: "divider",
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleWaveDrop(waveId, e)}
                      >
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                          <Typography variant="h6">Wave {waveId}</Typography>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip size="small" label={`${waveItems.length} deployment${waveItems.length === 1 ? "" : "s"}`} />
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => deployWave(waveId)}
                              disabled={waveItems.length === 0 || waveDeploying || deploying || !canDeploy}
                            >
                              {waveDeploying ? "Deploying…" : "Deploy wave"}
                            </Button>
                          </Stack>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          Drop agents here. Drag cards to reorder across waves.
                        </Typography>
                        <Stack spacing={1.2} sx={{ mt: 1 }}>
                          {waveItems.length === 0 && (
                            <Paper
                              variant="outlined"
                              sx={{
                                p: 2,
                                textAlign: "center",
                                borderStyle: "dashed",
                                borderColor: "divider",
                                color: "text.secondary",
                              }}
                            >
                              No deployments yet
                            </Paper>
                          )}
                          {waveItems.map((instance) => {
                            const statusLabel = instance.deploymentStatus ? instance.deploymentStatus.replace(/_/g, " ") : "Not deployed";
                            const statusColor = instance.deploymentStatus
                              ? instance.deploymentStatus.includes("success")
                                ? "success"
                                : instance.deploymentStatus.includes("error")
                                  ? "error"
                                  : "warning"
                              : "default";
                            const isSelected = selectedInstanceId === instance.id;
                            return (
                              <Paper
                                key={instance.id}
                                variant="outlined"
                                draggable
                                onDragStart={(e) => handleInstanceDragStart(instance.id, e)}
                                onClick={() => handleSelectInstanceItem(instance.id)}
                                sx={{
                                  p: 1.5,
                                  cursor: "grab",
                                  borderColor: isSelected ? "primary.main" : "divider",
                                  backgroundColor: isSelected ? "action.hover" : "background.paper",
                                }}
                              >
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                  <Box>
                                    <Typography variant="subtitle2">{instance.id}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {instance.repoName} • {instance.branch}
                                    </Typography>
                                  </Box>
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <Checkbox
                                      size="small"
                                      checked={selectedForFinalDeployment.includes(instance.id)}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        handleToggleInstanceCheckbox(instance.id);
                                      }}
                                    />
                                    <Chip size="small" label={statusLabel} color={statusColor} variant={statusColor === "default" ? "outlined" : "filled"} />
                                  </Stack>
                                </Stack>
                                <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center">
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectInstanceItem(instance.id);
                                    }}
                                  >
                                    Configure
                                  </Button>
                                  <Button
                                    size="small"
                                    color="error"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteDeploymentInstance(instance.id);
                                    }}
                                  >
                                    Delete
                                  </Button>
                                  {instance.job_execution_name && !isTerminalStatus(instance.deploymentStatus) && (
                                    <Tooltip title="Poll status">
                                      <IconButton
                                        size="small"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          manualPollInstance(instance.id);
                                        }}
                                      >
                                        <Refresh fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                </Stack>
                              </Paper>
                            );
                          })}
                        </Stack>
                      </Paper>
                    </Grid>
                  );
                })}
              </Grid>

              {currentInstance && currentConfig ? (
                <Paper variant="outlined" sx={{ p: 3 }}>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={2} pb={2} borderBottom="1px solid #eee">
                    <Box>
                      <Typography variant="h4" sx={{ color: "#1976d2" }}>
                        Configuring: {currentInstance.id}
                      </Typography>
                      <Typography variant="subtitle1" sx={{ color: "text.secondary" }}>
                        Agent: {currentInstance.repoName} | Branch: {currentInstance.branch}
                        {currentInstance.envLoading && <CircularProgress size={16} sx={{ ml: 1 }} />}
                      </Typography>
                    </Box>
                    <Box display="flex" gap={2} flexWrap="wrap">
                      <Button
                        variant="outlined"
                        onClick={() => {
                          generateFinalJSON();
                          setJsonDialogOpen(true);
                        }}
                        disabled={selectedForFinalDeployment.length === 0}
                      >
                        Preview Deployment JSON
                      </Button>
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={() => triggerDeployment()}
                        disabled={deploying || selectedForFinalDeployment.length === 0 || !canDeploy}
                      >
                        {deploying ? <CircularProgress size={24} color="inherit" /> : `Deploy ${selectedForFinalDeployment.length} Selected`}
                      </Button>
                      {!canDeploy && (
                        <Typography variant="caption" color="error" sx={{ display: "block" }}>
                          Activate source and target credentials before deploying.
                        </Typography>
                      )}
                      <Tooltip title="Delete this deployment configuration">
                        <IconButton onClick={() => handleDeleteDeploymentInstance(currentInstance.id)} color="error" size="small">
                          <Delete />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>

                  <Grid container spacing={3}>
                    {Object.keys(defaultConfig)
                      .filter(field => ![
                        "connectDatabase", "database_instance", "database_name", "db_username",
                        "db_password", "superuser_username", "superuser_password", "init_script_path",
                        "extra_env", "buckets", "bucket_mounts", "rawBuckets",
                        "repo_url", "branch"
                      ].includes(field))
                      .map((field) => (
                        <Grid item xs={12} sm={6} key={`${selectedInstanceId}-${field}`}>
                          <DescriptiveField
                            key={`${selectedInstanceId}-${field}-descriptive`}
                            fullWidth
                            variant="outlined"
                            margin="dense"
                            name={field}
                            label={field.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                            value={currentConfig[field] || ""}
                            onChange={(e) => handleInstanceConfigChange(selectedInstanceId, field, e.target.value)}
                            tooltipTitle={
                              field === "github_token" ? "GitHub PAT for agent repository access." :
                                field === "region" ? "GCP region for deploying resources." :
                                  field === "service_name" ? "Unique name for the Cloud Run service." :
                                    null
                            }
                          />
                        </Grid>
                      ))}
                    <Grid item xs={12} sm={6}>
                      <TextField label="Agent Repository URL (Read-only)" variant="outlined" fullWidth margin="dense" value={currentConfig.repo_url || ""} InputProps={{ readOnly: true }} InputLabelProps={{ sx: { color: "#555" } }} sx={{ "& .MuiInputBase-input": { color: "#777", backgroundColor: "#f9f9f9" } }} />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField label="Branch (Read-only)" variant="outlined" fullWidth margin="dense" value={currentConfig.branch || ""} InputProps={{ readOnly: true }} InputLabelProps={{ sx: { color: "#555" } }} sx={{ "& .MuiInputBase-input": { color: "#777", backgroundColor: "#f9f9f9" } }} />
                    </Grid>

                    <Grid item xs={12}>
                      <FormControlLabel control={<Checkbox checked={!!currentConfig.connectDatabase} onChange={(e) => handleInstanceConnectDatabaseToggle(selectedInstanceId, e.target.checked)} sx={{ color: "#007bff" }} />} label={<Typography sx={{ color: "#000" }}>Connect to Cloud SQL Database?</Typography>} />
                    </Grid>
                    {currentConfig.connectDatabase && (
                      <>
                        <Grid item xs={12} sm={6}><DescriptiveField fullWidth variant="outlined" margin="dense" label="Database Instance Name" value={currentConfig.database_instance || ""} onChange={(e) => handleInstanceConfigChange(selectedInstanceId, "database_instance", e.target.value)} tooltipTitle="Unique name for Cloud SQL instance." /></Grid>
                        <Grid item xs={12} sm={6}><DescriptiveField fullWidth variant="outlined" margin="dense" label="Logical Database Name" value={currentConfig.database_name || ""} onChange={(e) => handleInstanceConfigChange(selectedInstanceId, "database_name", e.target.value)} tooltipTitle="Name for logical database in instance." /></Grid>
                        <Grid item xs={12} sm={6}><DescriptiveField fullWidth variant="outlined" margin="dense" label="Application DB Username" value={currentConfig.db_username || ""} onChange={(e) => handleInstanceConfigChange(selectedInstanceId, "db_username", e.target.value)} tooltipTitle="App DB user (created with 'cloudsqlsuperuser' role)." /></Grid>
                        <Grid item xs={12} sm={6}><DescriptiveField fullWidth variant="outlined" margin="dense" type="password" label="Application DB Password" value={currentConfig.db_password || ""} onChange={(e) => handleInstanceConfigChange(selectedInstanceId, "db_password", e.target.value)} tooltipTitle="Password for app DB user." /></Grid>
                        <Grid item xs={12} sm={6}><DescriptiveField fullWidth variant="outlined" margin="dense" label="Instance Superuser Username" value={currentConfig.superuser_username || ""} onChange={(e) => handleInstanceConfigChange(selectedInstanceId, "superuser_username", e.target.value)} tooltipTitle="Cloud SQL admin (default: 'postgres'). Used for setup." /></Grid>
                        <Grid item xs={12} sm={6}><DescriptiveField fullWidth variant="outlined" margin="dense" type="password" label="Instance Superuser Password" value={currentConfig.superuser_password || ""} onChange={(e) => handleInstanceConfigChange(selectedInstanceId, "superuser_password", e.target.value)} tooltipTitle="Password for Cloud SQL admin." /></Grid>
                        <Grid item xs={12} sm={6}><DescriptiveField fullWidth variant="outlined" margin="dense" label="DB Init Script Path (in agent repo)" value={currentConfig.init_script_path || ""} onChange={(e) => handleInstanceConfigChange(selectedInstanceId, "init_script_path", e.target.value)} tooltipTitle="Path in the agent repository to .sql for schema/data (e.g., 'sql/schema.sql')." /></Grid>
                        <Grid item xs={12} sm={6} sx={{ display: "flex", alignItems: "center", pt: "8px" }}>
                          <Button variant="outlined" onClick={() => validateInstanceDatabase(selectedInstanceId)}>Validate DB Setup</Button>
                        </Grid>
                      </>
                    )}

                    <Grid item xs={12}>
                      <Typography variant="subtitle1" sx={{ color: "#000", mt: 2, fontWeight: "bold" }}>
                        Extra Environment Variables {currentInstance.envLoading && <CircularProgress size={14} sx={{ ml: 1 }} />}
                      </Typography>
                    </Grid>
                    {currentInstance?.availableEnvSources && currentInstance.availableEnvSources.length > 0 ? (
                      <Grid item xs={12} sm={6}>
                        <FormControl fullWidth margin="dense" size="small">
                          <InputLabel id={`env-source-select-label-${selectedInstanceId}`}>Env Source</InputLabel>
                          <Select
                            labelId={`env-source-select-label-${selectedInstanceId}`}
                            value={currentInstance.selectedEnvSource || ""}
                            label="Env Source"
                            onChange={(e) => handleEnvSourceSelection(selectedInstanceId, e.target.value)}
                          >
                            {currentInstance.availableEnvSources.map((source) => (
                              <MenuItem key={source.name} value={source.name}>{source.label}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <Typography variant="caption" sx={{ color: "#555", display: "block", mt: 0.5 }}>
                          Switch between agent baseline files.
                        </Typography>
                      </Grid>
                    ) : (
                      !currentInstance?.envLoading && (
                        <Grid item xs={12}>
                          <Typography variant="caption" sx={{ color: "#777" }}>
                            No .env files detected for this branch. Add variables manually below.
                          </Typography>
                        </Grid>
                      )
                    )}
                    {currentConfig.extra_env && currentConfig.extra_env.map((pair, index) => {
                      const isExampleDefault = !!pair.matchesExample && !!pair.key;
                      return (
                        <Grid container item spacing={1} key={`${selectedInstanceId}-env-${index}`} alignItems="center" xs={12}>
                          <Grid item xs={5}>
                            <TextField
                              label="Key"
                              variant="outlined"
                              fullWidth
                              margin="dense"
                              value={pair.key || ""}
                              onChange={(e) => handleInstanceExtraEnvChange(selectedInstanceId, index, "key", e.target.value)}
                              InputLabelProps={{ sx: { color: "#555" } }}
                              sx={{ "& .MuiInputBase-input": { color: "#000", ...(isExampleDefault ? { backgroundColor: "#fff3cd" } : {}) } }}
                            />
                          </Grid>
                          <Grid item xs={5}>
                            <TextField
                              label="Value"
                              variant="outlined"
                              fullWidth
                              margin="dense"
                              value={pair.value || ""}
                              onChange={(e) => handleInstanceExtraEnvChange(selectedInstanceId, index, "value", e.target.value)}
                              InputLabelProps={{ sx: { color: "#555" } }}
                              sx={{ "& .MuiInputBase-input": { color: "#000", ...(isExampleDefault ? { backgroundColor: "#fff3cd" } : {}) } }}
                              helperText={isExampleDefault ? "Using example default" : " "}
                              FormHelperTextProps={{ sx: { color: "#b26a00", fontSize: "0.7rem", lineHeight: 1.2 } }}
                            />
                          </Grid>
                          <Grid item xs={2}>
                            <IconButton onClick={() => removeInstanceExtraEnvVar(selectedInstanceId, index)} aria-label="delete environment variable">
                              <Delete sx={{ color: "#dc3545" }} />
                            </IconButton>
                          </Grid>
                        </Grid>
                      );
                    })}
                    <Grid item xs={12}>
                      <Button variant="outlined" startIcon={<Add />} onClick={() => addInstanceExtraEnvVar(selectedInstanceId)} sx={{ color: "#007bff", borderColor: "#007bff" }}>
                        Add Env Var
                      </Button>
                    </Grid>

                    <Grid item xs={12}>
                      <Typography variant="subtitle1" sx={{ color: "#000", mt: 2, fontWeight: "bold" }}>Storage Buckets</Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <DescriptiveField
                        fullWidth
                        variant="outlined"
                        margin="dense"
                        label="Additional Storage Buckets"
                        value={currentConfig.rawBuckets || ""}
                        onChange={(e) => handleInstanceBucketsChange(selectedInstanceId, e.target.value)}
                        onBlur={(e) => handleInstanceBucketsBlur(selectedInstanceId, e.target.value)}
                        tooltipTitle="Comma-separated GCS bucket names. Created if new. App accesses via GCS libraries. NOT auto-mounted."
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" sx={{ color: "#000", mt: 1, fontWeight: "medium" }}>Cloud Run Bucket Mounts</Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="caption" display="block" sx={{ color: "#555", mb: 1 }}>
                        Buckets created (if new) & mounted into Cloud Run service filesystem.
                      </Typography>
                    </Grid>
                    {currentConfig.bucket_mounts && currentConfig.bucket_mounts.map((mount, index) => (
                      <Grid container item spacing={1} key={`${selectedInstanceId}-mount-${index}`} alignItems="center" xs={12}>
                        <Grid item xs={5}>
                          <DescriptiveField
                            fullWidth
                            variant="outlined"
                            margin="dense"
                            label="Bucket Name (to mount)"
                            value={mount.bucket || ""}
                            onChange={(e) => handleInstanceBucketMountChange(selectedInstanceId, index, "bucket", e.target.value)}
                            tooltipTitle="Name of GCS bucket to mount."
                          />
                        </Grid>
                        <Grid item xs={5}>
                          <DescriptiveField
                            fullWidth
                            variant="outlined"
                            margin="dense"
                            label="Mount Path (in container)"
                            value={mount.mount_path || ""}
                            onChange={(e) => handleInstanceBucketMountChange(selectedInstanceId, index, "mount_path", e.target.value)}
                            tooltipTitle="Absolute path in Cloud Run container (e.g., /data)."
                          />
                        </Grid>
                        <Grid item xs={2}>
                          <IconButton onClick={() => removeInstanceBucketMount(selectedInstanceId, index)} aria-label="delete bucket mount">
                            <Delete sx={{ color: "#dc3545" }} />
                          </IconButton>
                        </Grid>
                      </Grid>
                    ))}
                    <Grid item xs={12}>
                      <Button variant="outlined" startIcon={<Add />} onClick={() => addInstanceBucketMount(selectedInstanceId)} sx={{ color: "#007bff", borderColor: "#007bff" }}>
                        Add Bucket Mount
                      </Button>
                    </Grid>
                    <Grid item xs={12} sx={{ mt: 1 }}>
                      <Button variant="outlined" onClick={() => validateInstanceBuckets(selectedInstanceId)}>Validate Bucket Names & Access</Button>
                    </Grid>
                  </Grid>

                  {currentInstance && (currentInstance.deploymentLog || currentInstance.deploymentError || currentInstance.deploymentStatus) && (
                    <Paper
                      elevation={1}
                      sx={{
                        mt: 4,
                        p: 2,
                        backgroundColor: currentInstance.deploymentStatus?.includes("error")
                          ? "#ffebee"
                          : currentInstance.deploymentStatus?.includes("success")
                            ? "#e8f5e9"
                            : currentInstance.deploymentStatus?.includes("pending") || currentInstance.deploymentStatus?.includes("polling")
                              ? "#fff3e0"
                              : "#ffffff",
                      }}
                    >
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Typography variant="h6" gutterBottom>
                          Deployment Status: {currentInstance.id}
                        </Typography>
                        {currentInstance.job_execution_name && !isTerminalStatus(currentInstance.deploymentStatus) && (
                          <Tooltip title="Refresh Status">
                            <IconButton onClick={() => manualPollInstance(currentInstance.id)} size="small">
                              <Refresh />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                      {currentInstance.deploymentStatus && (
                        <Typography
                          variant="subtitle1"
                          sx={{
                            color: currentInstance.deploymentStatus.includes("success")
                              ? "green"
                              : currentInstance.deploymentStatus.includes("error")
                                ? "red"
                                : "orange",
                            fontWeight: "bold",
                            mb: 1,
                          }}
                        >
                          Outcome: {currentInstance.deploymentStatus.replace(/_/g, " ")}
                          {(currentInstance.deploymentStatus.includes("pending") || currentInstance.deploymentStatus.includes("polling") || currentInstance.deploymentStatus.includes("submitted")) && (
                            <CircularProgress size={14} sx={{ ml: 1 }} />
                          )}
                        </Typography>
                      )}
                      {currentInstance.deployedUrl && (
                        <Typography variant="body2" sx={{ mb: 1, fontWeight: "bold", color: "green" }}>
                          Service URL:{" "}
                          <Link href={currentInstance.deployedUrl} target="_blank" rel="noopener noreferrer" sx={{ display: "inline-flex", alignItems: "center", color: "green" }}>
                            {currentInstance.deployedUrl} <Launch fontSize="small" sx={{ ml: 0.5 }} />
                          </Link>
                        </Typography>
                      )}
                      {currentInstance.deploymentError && (
                        <Box sx={{ mt: 1, color: "red" }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: "bold" }}>
                            Error Details:
                          </Typography>
                          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "0.8rem", maxHeight: "150px", overflowY: "auto", backgroundColor: "#fff", padding: "8px", border: "1px solid #ef9a9a", borderRadius: "4px" }}>
                            {currentInstance.deploymentError}
                          </pre>
                        </Box>
                      )}
                      {currentInstance.deploymentLog && (
                        <Box sx={{ mt: 1 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: "bold" }}>
                            Full Log:
                          </Typography>
                          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "0.8rem", maxHeight: "200px", overflowY: "auto", backgroundColor: "#f5f5f5", padding: "8px", border: "1px solid #ddd", borderRadius: "4px" }}>
                            {currentInstance.deploymentLog}
                          </pre>
                        </Box>
                      )}
                    </Paper>
                  )}
                </Paper>
              ) : (
                <Paper variant="outlined" sx={{ p: 3, textAlign: "center", color: "text.secondary" }}>
                  <Typography variant="h6" gutterBottom>
                    Drag an agent into a wave to start configuring.
                  </Typography>
                  <Typography variant="body2">Select a card to edit its environment, buckets, and deployment settings.</Typography>
                </Paper>
              )}
            </>
          )}
        </Stack>
      </PageLayout>

      <Dialog
        open={creationDialogOpen}
        onClose={() => {
          setCreationDialogOpen(false);
          setSelectedAgentForInstanceCreation(null);
          setNewBranchSelection("");
          setNewInstanceDeploymentId("");
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Configure deployment for Wave {pendingWave}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Agent: {selectedAgentForInstanceCreation || "—"}
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Deployment Instance ID"
                value={newInstanceDeploymentId}
                onChange={(e) => setNewInstanceDeploymentId(e.target.value)}
                helperText="Unique ID for this agent/branch config (e.g., myagent-main)."
                variant="outlined"
                margin="dense"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth margin="dense" disabled={!selectedAgentForInstanceCreation || agentBranchLoading[selectedAgentForInstanceCreation]}>
                <InputLabel id="new-instance-branch-label">Select Branch</InputLabel>
                <Select
                  labelId="new-instance-branch-label"
                  value={newBranchSelection}
                  label="Select Branch"
                  onChange={(e) => {
                    setNewBranchSelection(e.target.value);
                    const currentAgent = selectedAgentForInstanceCreation;
                    const currentSugg = `${currentAgent}-${newBranchSelection}`;
                    const newSugg = `${currentAgent}-${e.target.value}`;
                    if (!newInstanceDeploymentId || newInstanceDeploymentId === currentSugg || newInstanceDeploymentId.startsWith(currentAgent + "-")) {
                      setNewInstanceDeploymentId(newSugg);
                    }
                  }}
                >
                  {agentBranchLoading[selectedAgentForInstanceCreation] ? (
                    <MenuItem value="">
                      <em>Loading branches...</em>
                    </MenuItem>
                  ) : branchOptions[selectedAgentForInstanceCreation] && branchOptions[selectedAgentForInstanceCreation].length > 0 ? (
                    branchOptions[selectedAgentForInstanceCreation].map((branch) => (
                      <MenuItem key={branch.name} value={branch.name}>
                        {branch.name}
                      </MenuItem>
                    ))
                  ) : (
                    <MenuItem value="">
                      <em>No branches found or agent repository issue.</em>
                    </MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setCreationDialogOpen(false);
              setSelectedAgentForInstanceCreation(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => handleAddDeploymentInstance(pendingWave)}
            disabled={!selectedAgentForInstanceCreation || !newBranchSelection || !newInstanceDeploymentId.trim()}
          >
            Add to Wave {pendingWave}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={jsonDialogOpen} onClose={() => setJsonDialogOpen(false)} fullWidth maxWidth="md" PaperProps={{ style: { backgroundColor: "#fff", border: "1px solid #ccc" } }} hideBackdrop >
        <DialogTitle sx={{ color: "#000", borderBottom: "1px solid #eee" }}>Generated Deployment JSON</DialogTitle>
        <DialogContent sx={{ backgroundColor: "#f9f9f9", maxHeight: "70vh", overflowY: 'auto' }}>
          <pre style={{ color: "#000", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{finalJSON || "No configurations selected or JSON not generated."}</pre>
        </DialogContent>
        <DialogActions sx={{ borderTop: "1px solid #eee", p: 2 }}><Button onClick={() => setJsonDialogOpen(false)} color="primary">Close</Button></DialogActions>
      </Dialog>
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={6000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage || deploymentMessage} // Show deployment message if snackbarMessage is empty
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}
