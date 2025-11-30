import { useState, useEffect, useReducer, useRef, useCallback } from "react";
import {
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemText,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormControlLabel,
  Alert,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import SectionCard from "../components/SectionCard.jsx";
import { useCredentialStoreBridge } from "../hooks/credentials/useCredentialStores.js";

const defaultBranch = "main";
const defaultGithubToken = import.meta.env.VITE_GITHUB_TOKEN || "";

// ============================================================================
// STATE REDUCER - Centralized state management
// ============================================================================
const initialState = {
  waves: { 0: [], 1: [], 2: [] },
  selectedAgentId: null,
  envData: {}, // { agentId: { env, envExample, deployed, branch, attempted } }
  envLoadingStatus: {}, // { agentId: 'loading' | 'success' | 'error' }
  branchOptions: {}, // { agentId: [{ name, commitSha }] }
  branchLoading: {}, // { agentId: true/false }
  agentConfigs: {}, // { agentId: { connectDatabase, dbInstance, ... } }
  githubToken: defaultGithubToken,
  githubBranch: defaultBranch,
};

function deploymentReducer(state, action) {
  switch (action.type) {
    case 'SET_WAVES':
      return { ...state, waves: action.payload };

    case 'SELECT_AGENT':
      return { ...state, selectedAgentId: action.payload };

    case 'SET_ENV_DATA':
      return {
        ...state,
        envData: {
          ...state.envData,
          [action.agentId]: action.payload,
        },
      };

    case 'SET_ENV_LOADING':
      return {
        ...state,
        envLoadingStatus: {
          ...state.envLoadingStatus,
          [action.agentId]: action.status,
        },
      };

    case 'SET_BRANCH_OPTIONS':
      return {
        ...state,
        branchOptions: {
          ...state.branchOptions,
          [action.agentId]: action.branches,
        },
      };

    case 'SET_BRANCH_LOADING':
      return {
        ...state,
        branchLoading: {
          ...state.branchLoading,
          [action.agentId]: action.loading,
        },
      };

    case 'SET_GITHUB_BRANCH':
      return { ...state, githubBranch: action.payload };

    case 'UPDATE_AGENT_CONFIG':
      return {
        ...state,
        agentConfigs: {
          ...state.agentConfigs,
          [action.agentId]: {
            ...(state.agentConfigs[action.agentId] || {}),
            [action.field]: action.value
          }
        }
      };

    // Env Var Management Actions
    case 'SET_ENV_SOURCE':
      return {
        ...state,
        envData: {
          ...state.envData,
          [action.agentId]: {
            ...state.envData[action.agentId],
            selectedSource: action.source
          }
        }
      };

    case 'UPDATE_ENV_VAR': {
      const agentData = state.envData[action.agentId];
      const source = agentData.selectedSource || 'env';
      const list = [...(agentData[source] || [])];

      list[action.index] = {
        ...list[action.index],
        [action.field]: action.value
      };

      return {
        ...state,
        envData: {
          ...state.envData,
          [action.agentId]: {
            ...agentData,
            [source]: list
          }
        }
      };
    }

    case 'ADD_ENV_VAR': {
      const agentData = state.envData[action.agentId];
      const source = agentData.selectedSource || 'env';
      const list = [...(agentData[source] || [])];

      list.push({ key: '', value: '', matchesExample: false });

      return {
        ...state,
        envData: {
          ...state.envData,
          [action.agentId]: {
            ...agentData,
            [source]: list
          }
        }
      };
    }

    case 'DELETE_ENV_VAR': {
      const agentData = state.envData[action.agentId];
      const source = agentData.selectedSource || 'env';
      const list = (agentData[source] || []).filter((_, i) => i !== action.index);

      return {
        ...state,
        envData: {
          ...state.envData,
          [action.agentId]: {
            ...agentData,
            [source]: list
          }
        }
      };
    }

    default:
      return state;
  }
}

// ============================================================================
// CUSTOM HOOK - Fetch Branches from GitHub
// ============================================================================
function useBranchFetcher(dispatch) {
  const fetchedReposRef = useRef(new Set());

  const fetchBranches = useCallback(async (agent) => {
    if (!agent) return;

    const agentId = agent.name || agent.instance_id || agent.id;
    const repoUrl = agent.repo_url || agent.repository_url;

    if (!repoUrl) return;

    // Deduplicate - only fetch once per repo
    if (fetchedReposRef.current.has(agentId)) return;
    fetchedReposRef.current.add(agentId);

    dispatch({ type: 'SET_BRANCH_LOADING', agentId, loading: true });

    try {
      const cleanRepoUrl = repoUrl.replace(/\.git$/, '');
      const [owner, repo] = cleanRepoUrl.replace('https://github.com/', '').split('/');

      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches`, {
        headers: { Authorization: `token ${defaultGithubToken}` },
      });

      if (!response.ok) {
        console.error(`Failed to fetch branches for ${agentId}: ${response.status}`);
        return;
      }

      const data = await response.json();
      const branches = Array.isArray(data) ? data.map(b => ({ name: b.name, commitSha: b.commit.sha })) : [];

      dispatch({ type: 'SET_BRANCH_OPTIONS', agentId, branches });
    } catch (error) {
      console.error(`Error fetching branches for ${agentId}:`, error);
    } finally {
      dispatch({ type: 'SET_BRANCH_LOADING', agentId, loading: false });
    }
  }, [dispatch]);

  return { fetchBranches };
}

// ============================================================================
// CUSTOM HOOK - Environment Loading with AbortController
// ============================================================================
// Helper to parse .env content into array with example matching
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

// ============================================================================
// CUSTOM HOOK - Environment Loading with AbortController
// ============================================================================
function useEnvLoader(dispatch) {
  const abortControllerRef = useRef(null);
  const inflightRef = useRef(new Map());

  const loadEnv = useCallback(async (agent) => {
    if (!agent) return;

    const agentId = agent.name || agent.instance_id || agent.id;
    const repoUrl = agent.repo_url || agent.repository_url;
    const branch = agent.branch || defaultBranch;

    if (!repoUrl) {
      console.warn('No repo URL for agent:', agentId);
      return;
    }

    const requestKey = `${agentId}-${branch}`;

    // Cancel previous request if it was for a different agent/branch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Deduplication
    if (inflightRef.current.has(requestKey)) {
      return inflightRef.current.get(requestKey);
    }

    abortControllerRef.current = new AbortController();
    dispatch({ type: 'SET_ENV_LOADING', agentId, status: 'loading' });

    const fetchPromise = (async () => {
      try {
        const cleanRepoUrl = repoUrl.replace(/\.git$/, '');
        const [owner, repo] = cleanRepoUrl.replace('https://github.com/', '').split('/');
        const signal = abortControllerRef.current.signal;

        // Helper to fetch single file
        const fetchFile = async (path) => {
          try {
            const res = await fetch(`/api/github/content/${owner}/${repo}/${path}?ref=${branch}`, { signal });
            if (!res.ok) return null;
            const data = await res.json();
            return data.content ? atob(data.content) : null;
          } catch (e) {
            if (e.name !== 'AbortError') console.error(`Failed to fetch ${path}`, e);
            return null;
          }
        };

        // Fetch both files in parallel
        const [envContent, exampleContent] = await Promise.all([
          fetchFile('.env'),
          fetchFile('.env.example')
        ]);

        if (signal.aborted) return;

        // Process .env.example first to establish defaults
        const exampleDefaults = {};
        let envExampleArr = [];

        if (exampleContent) {
          envExampleArr = parseDotEnvToArray(exampleContent, new Map());
          envExampleArr.forEach(({ key, value }) => {
            exampleDefaults[key] = value;
          });
        }

        // Process .env using defaults
        const envArr = envContent
          ? parseDotEnvToArray(envContent, new Map(Object.entries(exampleDefaults)))
          : [];

        // If no .env, use example as base for "env" source but mark as not matching since it's a new copy
        const finalEnv = envArr.length > 0 ? envArr : envExampleArr.map(item => ({ ...item, matchesExample: true }));

        dispatch({
          type: 'SET_ENV_DATA',
          agentId,
          payload: {
            env: finalEnv,
            envExample: envExampleArr,
            deployed: [], // Placeholder for now
            exampleDefaults,
            selectedSource: envContent ? 'env' : 'envExample',
            attempted: true
          }
        });

        dispatch({ type: 'SET_ENV_LOADING', agentId, status: 'success' });

      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Error loading env:', error);
          dispatch({ type: 'SET_ENV_LOADING', agentId, status: 'error' });
          dispatch({
            type: 'SET_ENV_DATA',
            agentId,
            payload: { attempted: true, error: error.message }
          });
        }
      } finally {
        inflightRef.current.delete(requestKey);
      }
    })();

    inflightRef.current.set(requestKey, fetchPromise);
    return fetchPromise;

  }, [dispatch]);

  return { loadEnv };
}

function parseEnvContent(data) {
  if (!data?.content) return {};
  const raw = atob(data.content);
  const lines = raw.split('\n');
  const result = {};

  lines.forEach(line => {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      result[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });

  return result;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function DeploymentsPage() {
  const [state, dispatch] = useReducer(deploymentReducer, initialState);
  const { loadEnv } = useEnvLoader(dispatch);
  const { fetchBranches } = useBranchFetcher(dispatch);
  const credentialBridge = useCredentialStoreBridge();
  const readyForDeployment = credentialBridge.hasAllActive;

  // Load sample data on mount
  useEffect(() => {
    // All system agents with REAL repo URLs from sample_userrequirements.json
    const sampleAgents = [
      { id: 'thunderdome-core', name: 'ThunderdomCore', label: 'Thunderdome Core', wave: 0, repo_url: 'https://github.com/thunderdomeai/ThunderdomeCore.git', branch: 'ynv' },
      { id: 'broker', name: 'Broker', label: 'Broker', wave: 1, repo_url: 'https://github.com/thunderdomeai/broker.git', branch: 'main' },
      { id: 'scheduling-agent', name: 'SchedulingAgent', label: 'Scheduling Agent', wave: 1, repo_url: 'https://github.com/thunderdomeai/schedulingagent.git', branch: 'ynv' },
      { id: 'scheduling-monitor', name: 'SchedulingMonitor', label: 'Scheduling Monitor', wave: 2, repo_url: 'https://github.com/thunderdomeai/schedulingmonitor.git', branch: 'ynv' },
      { id: 'whatsapp-handler', name: 'WhatsAppHandler', label: 'WhatsApp Handler', wave: 2, repo_url: 'https://github.com/thunderdomeai/whatsapphandler.git', branch: 'main' },
      { id: 'user-portal', name: 'UserPortal', label: 'User Portal', wave: 2, repo_url: 'https://github.com/thunderdomeai/user_portal.git', branch: 'main' },
      { id: 'web-research-agent', name: 'WebResearchAgent', label: 'Web Research Agent', wave: 1, repo_url: 'https://github.com/thunderdomeai/web-research-agent.git', branch: 'ynv' },
      { id: 'mcp-client-agent', name: 'MCPClientAgent', label: 'MCP Client Agent', wave: 1, repo_url: 'https://github.com/thunderdomeai/mcpclientagent.git', branch: 'ynv' },
      { id: 'mcp-registry', name: 'MCPRegistry', label: 'MCP Registry', wave: 0, repo_url: 'https://github.com/thunderdomeai/mcpregistry.git', branch: 'main' },
      { id: 'thunder-mcp-sql', name: 'ThunderMCPSQL', label: 'Thunder MCP SQL', wave: 0, repo_url: 'https://github.com/thunderdomeai/thundermcpsql.git', branch: 'broker-executor' },
    ];

    const waves = { 0: [], 1: [], 2: [] };
    sampleAgents.forEach(agent => {
      const wave = agent.wave ?? 0;
      if (!waves[wave]) waves[wave] = [];
      waves[wave].push(agent);
    });
    dispatch({ type: 'SET_WAVES', payload: waves });

    // Fetch branches for all agents
    sampleAgents.forEach(agent => fetchBranches(agent));
  }, [fetchBranches]);

  // Auto-load env when agent selected
  useEffect(() => {
    if (!state.selectedAgentId) return;

    const agent = Object.values(state.waves)
      .flat()
      .find(a => (a.name || a.instance_id || a.id) === state.selectedAgentId);

    if (agent && !state.envData[state.selectedAgentId]?.attempted) {
      loadEnv(agent);
    }

    return () => {
      // Cleanup on unmount/agent change
    };
  }, [state.selectedAgentId, state.waves, loadEnv, state.envData]);

  // Find selected agent
  const selectedAgent = state.selectedAgentId
    ? Object.values(state.waves).flat().find(a => a.id === state.selectedAgentId)
    : null;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Deployments
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Organize agents into deployment waves
      </Typography>
      {!readyForDeployment ? (
        <Alert severity="warning" sx={{ mt: 1, mb: 2 }}>
          Activate primed source and target credentials in the Credentials page before deploying.
        </Alert>
      ) : null}

      {/* Deployment Waves with Pills */}
      <SectionCard
        title="Deployment Waves"
        subtitle="Select an agent to configure"
        sx={{ mt: 2 }}
      >
        {Object.entries(state.waves).map(([waveId, agents]) => (
          <Box key={waveId} sx={{ mb: 3 }}>
            <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 600 }}>
              Wave {waveId}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {agents.map((agent) => (
                <Chip
                  key={agent.id}
                  label={agent.label || agent.name}
                  onClick={() => dispatch({ type: 'SELECT_AGENT', payload: agent.id })}
                  color={state.selectedAgentId === agent.id ? "primary" : "default"}
                  variant={state.selectedAgentId === agent.id ? "filled" : "outlined"}
                  sx={{
                    cursor: 'pointer',
                    fontWeight: state.selectedAgentId === agent.id ? 600 : 400,
                    '&:hover': {
                      bgcolor: state.selectedAgentId === agent.id ? 'primary.dark' : 'action.hover',
                    },
                  }}
                />
              ))}
            </Stack>
          </Box>
        ))}

        {Object.values(state.waves).every(wave => wave.length === 0) && (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            No agents configured
          </Typography>
        )}
      </SectionCard>

      {/* Configuration Panel */}
      {
        selectedAgent && (
          <SectionCard
            title={`Configure: ${selectedAgent.label || selectedAgent.name}`}
            subtitle="Environment variables and deployment settings"
            sx={{ mt: 2 }}
          >
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={2}>
                {/* Branch and Repo Controls */}
                <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Branch</InputLabel>
                    <Select
                      value={selectedAgent.branch || defaultBranch}
                      label="Branch"
                      onChange={(e) => {
                        const newBranch = e.target.value;
                        // Update agent branch
                        const updatedAgent = { ...selectedAgent, branch: newBranch };
                        const newWaves = { ...state.waves };
                        Object.keys(newWaves).forEach(waveId => {
                          newWaves[waveId] = newWaves[waveId].map(a =>
                            a.id === selectedAgent.id ? updatedAgent : a
                          );
                        });
                        dispatch({ type: 'SET_WAVES', payload: newWaves });

                        // Clear env data for this agent to force reload
                        dispatch({
                          type: 'SET_ENV_DATA',
                          agentId: state.selectedAgentId,
                          payload: { attempted: false }
                        });

                        // Auto-reload with new branch
                        setTimeout(() => loadEnv(updatedAgent), 100);
                      }}
                    >
                      {state.branchLoading[state.selectedAgentId] ? (
                        <MenuItem value="" disabled><em>Loading branches...</em></MenuItem>
                      ) : state.branchOptions[state.selectedAgentId]?.length > 0 ? (
                        state.branchOptions[state.selectedAgentId].map(branch => (
                          <MenuItem key={branch.name} value={branch.name}>{branch.name}</MenuItem>
                        ))
                      ) : (
                        <MenuItem value={selectedAgent.branch || defaultBranch}>{selectedAgent.branch || defaultBranch}</MenuItem>
                      )}
                    </Select>
                  </FormControl>

                  <TextField
                    label="Repository URL"
                    size="small"
                    fullWidth
                    value={selectedAgent.repo_url || ""}
                    InputProps={{ readOnly: true }}
                    sx={{ flex: 1 }}
                  />
                </Stack>

                {/* Loading Status */}
                <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#f9fafb' }}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Typography variant="subtitle2" sx={{ minWidth: 120 }}>
                      Loading Status:
                    </Typography>
                    <Chip
                      label={state.envLoadingStatus[state.selectedAgentId] || 'idle'}
                      size="small"
                      color={
                        state.envLoadingStatus[state.selectedAgentId] === 'success' ? 'success' :
                          state.envLoadingStatus[state.selectedAgentId] === 'loading' ? 'warning' :
                            state.envLoadingStatus[state.selectedAgentId] === 'error' ? 'error' : 'default'
                      }
                    />
                    <Typography variant="body2" color="text.secondary">
                      Branch: {state.envData[state.selectedAgentId]?.branch || selectedAgent.branch || defaultBranch}
                    </Typography>
                  </Stack>
                </Paper>

                {/* Database Configuration */}
                <Box sx={{ mt: 2, mb: 2 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={state.agentConfigs[state.selectedAgentId]?.connectDatabase || false}
                        onChange={(e) => dispatch({
                          type: 'UPDATE_AGENT_CONFIG',
                          agentId: state.selectedAgentId,
                          field: 'connectDatabase',
                          value: e.target.checked
                        })}
                      />
                    }
                    label="Connect to Cloud SQL Database?"
                  />

                  {state.agentConfigs[state.selectedAgentId]?.connectDatabase && (
                    <Grid container spacing={2} sx={{ mt: 1, pl: 2, borderLeft: '2px solid #eee' }}>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Database Instance Name"
                          fullWidth
                          size="small"
                          value={state.agentConfigs[state.selectedAgentId]?.dbInstance || `${selectedAgent.id}-db`}
                          onChange={(e) => dispatch({
                            type: 'UPDATE_AGENT_CONFIG',
                            agentId: state.selectedAgentId,
                            field: 'dbInstance',
                            value: e.target.value
                          })}
                          helperText="e.g. thunderdomecore-version2-db"
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Logical Database Name"
                          fullWidth
                          size="small"
                          value={state.agentConfigs[state.selectedAgentId]?.dbName || `${selectedAgent.id}_data`}
                          onChange={(e) => dispatch({
                            type: 'UPDATE_AGENT_CONFIG',
                            agentId: state.selectedAgentId,
                            field: 'dbName',
                            value: e.target.value
                          })}
                          helperText="e.g. thunderdomecore_version2_data"
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Application DB Username"
                          fullWidth
                          size="small"
                          value={state.agentConfigs[state.selectedAgentId]?.dbUser || 'app_user'}
                          onChange={(e) => dispatch({
                            type: 'UPDATE_AGENT_CONFIG',
                            agentId: state.selectedAgentId,
                            field: 'dbUser',
                            value: e.target.value
                          })}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Application DB Password"
                          fullWidth
                          size="small"
                          type="password"
                          value={state.agentConfigs[state.selectedAgentId]?.dbPass || ''}
                          onChange={(e) => dispatch({
                            type: 'UPDATE_AGENT_CONFIG',
                            agentId: state.selectedAgentId,
                            field: 'dbPass',
                            value: e.target.value
                          })}
                          placeholder="••••••••"
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Instance Superuser Username"
                          fullWidth
                          size="small"
                          value={state.agentConfigs[state.selectedAgentId]?.superuser || 'postgres'}
                          onChange={(e) => dispatch({
                            type: 'UPDATE_AGENT_CONFIG',
                            agentId: state.selectedAgentId,
                            field: 'superuser',
                            value: e.target.value
                          })}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Instance Superuser Password"
                          fullWidth
                          size="small"
                          type="password"
                          value={state.agentConfigs[state.selectedAgentId]?.superPass || ''}
                          onChange={(e) => dispatch({
                            type: 'UPDATE_AGENT_CONFIG',
                            agentId: state.selectedAgentId,
                            field: 'superPass',
                            value: e.target.value
                          })}
                          placeholder="••••••••"
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="DB Init Script Path (in agent repo)"
                          fullWidth
                          size="small"
                          value={state.agentConfigs[state.selectedAgentId]?.initScript || 'sql/init.sql'}
                          onChange={(e) => dispatch({
                            type: 'UPDATE_AGENT_CONFIG',
                            agentId: state.selectedAgentId,
                            field: 'initScript',
                            value: e.target.value
                          })}
                        />
                      </Grid>
                      <Grid item xs={12} md={6} display="flex" alignItems="center">
                        <Button variant="outlined" size="small">
                          Validate DB Setup
                        </Button>
                      </Grid>
                    </Grid>
                  )}
                </Box>

                {/* Buckets Configuration */}
                <Box sx={{ mt: 3, mb: 3, pt: 2, borderTop: '1px solid #eee' }}>
                  <Typography variant="h6" gutterBottom sx={{ fontSize: '1rem', fontWeight: 600 }}>
                    Storage Buckets
                  </Typography>

                  <TextField
                    label="Buckets (comma separated)"
                    fullWidth
                    size="small"
                    value={state.agentConfigs[state.selectedAgentId]?.rawBuckets || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const bucketsArr = val.split(',').map(s => s.trim()).filter(Boolean);

                      dispatch({
                        type: 'UPDATE_AGENT_CONFIG',
                        agentId: state.selectedAgentId,
                        field: 'rawBuckets',
                        value: val
                      });

                      dispatch({
                        type: 'UPDATE_AGENT_CONFIG',
                        agentId: state.selectedAgentId,
                        field: 'buckets',
                        value: bucketsArr
                      });
                    }}
                    helperText="e.g. my-bucket-1, my-bucket-2"
                    sx={{ mb: 2 }}
                  />

                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Bucket Mounts</Typography>
                  <Stack spacing={2}>
                    {(state.agentConfigs[state.selectedAgentId]?.bucketMounts || []).map((mount, index) => (
                      <Stack key={index} direction="row" spacing={2} alignItems="flex-start">
                        <TextField
                          label="Bucket Name"
                          size="small"
                          value={mount.bucket}
                          onChange={(e) => {
                            const newMounts = [...(state.agentConfigs[state.selectedAgentId]?.bucketMounts || [])];
                            newMounts[index] = { ...newMounts[index], bucket: e.target.value };
                            dispatch({
                              type: 'UPDATE_AGENT_CONFIG',
                              agentId: state.selectedAgentId,
                              field: 'bucketMounts',
                              value: newMounts
                            });
                          }}
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          label="Mount Path"
                          size="small"
                          value={mount.mountPath}
                          onChange={(e) => {
                            const newMounts = [...(state.agentConfigs[state.selectedAgentId]?.bucketMounts || [])];
                            newMounts[index] = { ...newMounts[index], mountPath: e.target.value };
                            dispatch({
                              type: 'UPDATE_AGENT_CONFIG',
                              agentId: state.selectedAgentId,
                              field: 'bucketMounts',
                              value: newMounts
                            });
                          }}
                          sx={{ flex: 1 }}
                        />
                        <IconButton
                          color="error"
                          onClick={() => {
                            const newMounts = (state.agentConfigs[state.selectedAgentId]?.bucketMounts || []).filter((_, i) => i !== index);
                            dispatch({
                              type: 'UPDATE_AGENT_CONFIG',
                              agentId: state.selectedAgentId,
                              field: 'bucketMounts',
                              value: newMounts
                            });
                          }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Stack>
                    ))}
                  </Stack>

                  <Button
                    startIcon={<AddIcon />}
                    onClick={() => {
                      const newMounts = [...(state.agentConfigs[state.selectedAgentId]?.bucketMounts || []), { bucket: '', mountPath: '' }];
                      dispatch({
                        type: 'UPDATE_AGENT_CONFIG',
                        agentId: state.selectedAgentId,
                        field: 'bucketMounts',
                        value: newMounts
                      });
                    }}
                    sx={{ mt: 1 }}
                  >
                    Add Mount
                  </Button>
                </Box>

                {state.envData[state.selectedAgentId] && (
                  <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #eee' }}>
                    <Typography variant="h6" gutterBottom sx={{ fontSize: '1rem', fontWeight: 600 }}>
                      Extra Environment Variables
                    </Typography>

                    <FormControl size="small" fullWidth sx={{ mb: 2 }}>
                      <InputLabel>Env Source</InputLabel>
                      <Select
                        value={state.envData[state.selectedAgentId].selectedSource || 'env'}
                        label="Env Source"
                        onChange={(e) => dispatch({
                          type: 'SET_ENV_SOURCE',
                          agentId: state.selectedAgentId,
                          source: e.target.value
                        })}
                      >
                        <MenuItem value="env">.env</MenuItem>
                        <MenuItem value="envExample">.env.example</MenuItem>
                        <MenuItem value="deployed" disabled>Deployed Config (Not available)</MenuItem>
                      </Select>
                    </FormControl>

                    <Typography variant="caption" display="block" sx={{ mb: 2, color: 'text.secondary' }}>
                      Switch between agent baseline files.
                    </Typography>

                    <Stack spacing={2}>
                      {(state.envData[state.selectedAgentId][state.envData[state.selectedAgentId].selectedSource || 'env'] || []).map((item, index) => (
                        <Stack key={index} direction="row" spacing={2} alignItems="flex-start">
                          <TextField
                            label="Key"
                            size="small"
                            value={item.key}
                            onChange={(e) => dispatch({
                              type: 'UPDATE_ENV_VAR',
                              agentId: state.selectedAgentId,
                              index,
                              field: 'key',
                              value: e.target.value
                            })}
                            sx={{ flex: 1 }}
                          />
                          <TextField
                            label="Value"
                            size="small"
                            value={item.value}
                            onChange={(e) => dispatch({
                              type: 'UPDATE_ENV_VAR',
                              agentId: state.selectedAgentId,
                              index,
                              field: 'value',
                              value: e.target.value
                            })}
                            sx={{ flex: 1 }}
                          />
                          <IconButton
                            color="error"
                            onClick={() => dispatch({
                              type: 'DELETE_ENV_VAR',
                              agentId: state.selectedAgentId,
                              index
                            })}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Stack>
                      ))}
                    </Stack>

                    <Button
                      startIcon={<AddIcon />}
                      onClick={() => dispatch({ type: 'ADD_ENV_VAR', agentId: state.selectedAgentId })}
                      sx={{ mt: 2 }}
                    >
                      Add Variable
                    </Button>
                  </Box>
                )}

                {/* Validation Actions */}
                <Box sx={{ mt: 4, pt: 2, borderTop: '1px solid #eee', display: 'flex', gap: 2 }}>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={() => {
                      const config = state.agentConfigs[state.selectedAgentId] || {};
                      const errors = [];

                      // Validate DB
                      if (config.connectDatabase) {
                        if (!config.dbInstance) errors.push("Database Instance Name is required");
                        if (!config.dbName) errors.push("Logical Database Name is required");
                        if (!config.dbUser) errors.push("App DB User is required");
                      }

                      // Validate Buckets
                      if (config.buckets) {
                        config.buckets.forEach(b => {
                          if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(b)) {
                            errors.push(`Invalid bucket name: ${b}`);
                          }
                        });
                      }

                      // Validate Mounts
                      if (config.bucketMounts) {
                        config.bucketMounts.forEach(m => {
                          if (!m.bucket) errors.push("Mount bucket name missing");
                          if (!m.mountPath) errors.push("Mount path missing");
                        });
                      }

                      if (errors.length > 0) {
                        alert("Validation Failed:\n" + errors.join("\n"));
                      } else {
                        alert("Configuration Valid! ✅");
                      }
                    }}
                  >
                    Validate Configuration
                  </Button>
                </Box>
              </Stack>
            </Paper>
          </SectionCard>
        )
      }

      {/* Deploy Button */}
      <Box sx={{ mt: 3 }}>
        <Button variant="contained" size="large">
          Deploy All Waves
        </Button>
      </Box>
    </Box>
  );
}
