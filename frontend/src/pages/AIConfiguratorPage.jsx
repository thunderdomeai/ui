import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import BoltIcon from "@mui/icons-material/Bolt";
import DownloadIcon from "@mui/icons-material/Download";
import SectionCard from "../components/SectionCard.jsx";

const emptyDatabase = {
  name: "primary",
  type: "SQL Server",
  host: "127.0.0.1",
  port: "1433",
  database: "SBODemoUS",
  user: "sa",
  password_env: "DB_PASSWORD",
  mode: "preferred",
  instance: "",
  host_in_certificate: "",
  passwordInput: "",
};

const defaultConfig = {
  apiKey: "",
  serviceName: "AgentOneConnector-Primary",
  brokerUrl: "https://broker.example.com",
  agentId: "agent-one",
  apiKeyEnv: "BROKER_API_KEY",
  brokerKeyInput: "",
  pingInterval: 30000,
  dbType: "SQL Server",
  dbHost: "127.0.0.1",
  dbPort: "1433",
  dbName: "SBODemoUS",
  dbUser: "sa",
  dbPassword: "",
  logLevel: "info",
  queriesFile: "queries/default.json",
  databases: [emptyDatabase],
};

export default function AIConfiguratorPage() {
  const [config, setConfig] = useState(defaultConfig);
  const [secrets, setSecrets] = useState({});
  const [configKey, setConfigKey] = useState("");
  const [configs, setConfigs] = useState([]);
  const [currentRecord, setCurrentRecord] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [saving, setSaving] = useState(false);

  const configuratorBase = window.__UNIFIED_UI_CONFIG__?.AGENTONE_CONFIGURATOR_URL || "";

  const resetConfig = () => {
    setConfig(defaultConfig);
    setSecrets({});
    setConfigKey("");
    setCurrentRecord(null);
  };

  const loadConfigs = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch("/api/agentone/configs");
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.detail || "Unable to load configurator catalog");
      }
      setConfigs(Array.isArray(body) ? body : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const hydrateFromRecord = useCallback((record, key) => {
    const cfg = record?.config || {};
    const broker = cfg.broker || {};
    const dbs = Array.isArray(cfg.databases) && cfg.databases.length ? cfg.databases : [emptyDatabase];
    const dbTypeGuess = dbs[0]?.type || dbs[0]?.db_type || defaultConfig.dbType;
    setConfig((prev) => ({
      ...prev,
      apiKey: key || record?.apiKey || "",
      serviceName: cfg.serviceName || record?.serviceName || prev.serviceName,
      brokerUrl: broker.url || prev.brokerUrl,
      agentId: broker.agent_id || record?.agentId || prev.agentId,
      apiKeyEnv: broker.api_key_env || prev.apiKeyEnv,
      pingInterval: broker.ping_interval_ms || prev.pingInterval,
      dbType: dbTypeGuess,
      dbHost: dbs[0]?.host || prev.dbHost,
      dbPort: String(dbs[0]?.port || prev.dbPort),
      dbName: dbs[0]?.database || prev.dbName,
      dbUser: dbs[0]?.user || prev.dbUser,
      dbPassword: "",
      logLevel: cfg.log?.level || prev.logLevel,
      queriesFile: cfg.queries_file || prev.queriesFile,
      brokerKeyInput: "",
      databases: dbs.map((db, idx) => ({
        ...emptyDatabase,
        ...db,
        name: db.name || `db-${idx + 1}`,
        type: db.type || db.db_type || dbTypeGuess,
        port: String(db.port || db.port === 0 ? db.port : emptyDatabase.port),
        passwordInput: "",
      })),
    }));
    setConfigKey(key || record?.apiKey || "");
    setCurrentRecord(record);
    setSecrets(record?.secrets || {});
  }, []);

  const loadConfig = useCallback(
    async (key) => {
      if (!key) return;
      setLoadingConfig(true);
      setError(null);
      setStatus(null);
      try {
        const res = await fetch(`/api/agentone/config/${key}`);
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.detail || "Failed to load configuration");
        }
        hydrateFromRecord(body, key);
        setStatus(`Loaded configuration ${body.serviceName || key}`);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingConfig(false);
      }
    },
    [hydrateFromRecord]
  );

  const preview = useMemo(
    () => {
      const mergedSecrets = { ...secrets };
      const databases = (config.databases || []).map((db, idx) => {
        const passwordEnv = (db.password_env || `DB_${idx}_PASSWORD`).trim() || `DB_${idx}_PASSWORD`;
        if (db.passwordInput) {
          mergedSecrets[passwordEnv] = db.passwordInput;
        }
        return {
          ...db,
          type: db.type || config.dbType,
          port: Number(db.port) || 0,
          password_env: passwordEnv,
        };
      });
      const brokerSecretKey = (config.apiKeyEnv || "BROKER_API_KEY").trim() || "BROKER_API_KEY";
      if (config.brokerKeyInput) {
        mergedSecrets[brokerSecretKey] = config.brokerKeyInput;
      }
      return {
        config: {
          ...(currentRecord?.config || {}),
          serviceName: config.serviceName || currentRecord?.serviceName || "AgentOneConnector-Primary",
          broker: {
            ...(currentRecord?.config?.broker || {}),
            url: config.brokerUrl,
            agent_id: config.agentId,
            api_key_env: config.apiKeyEnv,
            ping_interval_ms: Number(config.pingInterval) || 30000,
          },
          log: {
            ...(currentRecord?.config?.log || {}),
            level: config.logLevel || "info",
            audit_file: currentRecord?.config?.log?.audit_file || "logs/trace.log",
          },
          queries_file: config.queriesFile || currentRecord?.config?.queries_file || "queries/default.json",
          databases,
        },
        secrets: mergedSecrets,
      };
    },
    [config, currentRecord, secrets]
  );

  const handleChange = (field) => (event) => {
    setConfig((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleDbChange = (idx, field, value) => {
    setConfig((prev) => {
      const updated = [...prev.databases];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, databases: updated };
    });
  };

  const removeDb = (idx) => {
    setConfig((prev) => {
      if (prev.databases.length === 1) return prev;
      const updated = prev.databases.filter((_, i) => i !== idx);
      return { ...prev, databases: updated };
    });
  };

  const addDb = () => {
    setConfig((prev) => ({
      ...prev,
      databases: [
        ...prev.databases,
        {
          ...emptyDatabase,
          name: `db-${prev.databases.length + 1}`,
          type: prev.dbType || emptyDatabase.type,
          password_env: `DB_${prev.databases.length + 1}_PASSWORD`,
        },
      ],
    }));
  };

  const handleGenerate = () => {
    setStatus("Config generated. Ready to push to MCP registry and desktop app.");
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const payload = {
        ...preview,
        label: config.serviceName || currentRecord?.serviceName,
      };
      const missingSecrets = [];
      const brokerEnv = payload.config?.broker?.api_key_env;
      if (brokerEnv && !payload.secrets[brokerEnv]) {
        missingSecrets.push(brokerEnv);
      }
      (payload.config?.databases || []).forEach((db) => {
        if (db.password_env && !payload.secrets[db.password_env]) {
          missingSecrets.push(db.password_env);
        }
      });
      if ((payload.config?.databases || []).length === 0) {
        throw new Error("Add at least one database before saving.");
      }
      if (missingSecrets.length) {
        throw new Error(`Missing secret values for ${missingSecrets.join(", ")}`);
      }
      const isCreate = !configKey;
      const url = isCreate ? "/api/agentone/config" : `/api/agentone/config/${configKey}`;
      const method = isCreate ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.detail || "Save failed");
      }
      if (isCreate) {
        const newKey = body.api_key;
        setConfigKey(newKey);
        setStatus(`Saved. New API key ${newKey}`);
        await loadConfigs();
        await loadConfig(newKey);
      } else {
        setStatus("Configuration saved.");
        await loadConfig(configKey);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(preview.config, null, 2));
    const a = document.createElement("a");
    a.setAttribute("href", dataStr);
    a.setAttribute("download", "agentone-config.json");
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        AI Q/A Agent Configurator
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Borrowed from the Agent One (sapb1) configurator and embedded here. Guides the customer through broker settings and DB connectivity, then generates an MCP definition for the desktop app.
      </Typography>
      {configuratorBase ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Using configurator service at {configuratorBase}
        </Alert>
      ) : (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Agent One configurator URL is not configured. Update AGENTONE_CONFIGURATOR_URL for this deployment.
        </Alert>
      )}
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {status ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          {status}
        </Alert>
      ) : null}

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} md={6}>
          <SectionCard title="Stored configs" subtitle="Load existing Agent One API keys or start a fresh config.">
            <Stack spacing={2}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center">
                <TextField
                  label="Config API key"
                  value={configKey}
                  onChange={(e) => setConfigKey(e.target.value)}
                  fullWidth
                  placeholder="Paste API key to load"
                />
                <Button variant="contained" onClick={() => loadConfig(configKey)} disabled={!configKey || loadingConfig}>
                  {loadingConfig ? "Loading..." : "Load"}
                </Button>
                <Button variant="outlined" onClick={resetConfig}>
                  New config
                </Button>
              </Stack>
              <Divider />
              <Typography variant="subtitle2">Available configs</Typography>
              <Stack spacing={1} sx={{ maxHeight: 220, overflow: "auto" }}>
                {loadingList ? (
                  <Typography variant="body2" color="text.secondary">
                    Loading...
                  </Typography>
                ) : configs.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No configs discovered yet.
                  </Typography>
                ) : (
                  configs.map((item) => (
                    <Stack
                      key={item.apiKey}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      justifyContent="space-between"
                      sx={{
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 1,
                        px: 1.5,
                        py: 1,
                      }}
                    >
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {item.serviceName || "Unnamed service"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.apiKey}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip size="small" label={item.agentId || "agent"} />
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => loadConfig(item.apiKey)}
                          disabled={loadingConfig}
                        >
                          Load
                        </Button>
                      </Stack>
                    </Stack>
                  ))
                )}
              </Stack>
            </Stack>
          </SectionCard>
          <SectionCard title="Broker + Agent" subtitle="Matches the sapb1 configurator contract.">
            <Stack spacing={2}>
              <TextField label="Service name" value={config.serviceName} onChange={handleChange("serviceName")} />
              <TextField label="Broker URL" value={config.brokerUrl} onChange={handleChange("brokerUrl")} />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Agent ID" value={config.agentId} onChange={handleChange("agentId")} fullWidth />
                <TextField label="Broker API Key Env" value={config.apiKeyEnv} onChange={handleChange("apiKeyEnv")} fullWidth />
              </Stack>
              <TextField
                label="Broker API Key (secret)"
                value={config.brokerKeyInput}
                onChange={handleChange("brokerKeyInput")}
                helperText="Leave blank to reuse the existing secret for this env var."
              />
              <TextField
                label="Ping interval (ms)"
                value={config.pingInterval}
                onChange={handleChange("pingInterval")}
                type="number"
              />
              {configKey ? (
                <Chip size="small" color="primary" label={`Active config: ${configKey}`} sx={{ alignSelf: "flex-start" }} />
              ) : null}
            </Stack>
          </SectionCard>
          <SectionCard title="Database Connection" subtitle="Used to build the MCP for AI Q/A.">
            <Stack spacing={2}>
              <ToggleButtonGroup
                exclusive
                value={config.dbType}
                onChange={(_, value) => value && setConfig((prev) => ({ ...prev, dbType: value }))}
                size="small"
              >
                <ToggleButton value="PostgreSQL">PostgreSQL</ToggleButton>
                <ToggleButton value="SQL Server">SQL Server</ToggleButton>
              </ToggleButtonGroup>
              <Stack spacing={2}>
                {config.databases.map((db, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 2,
                      p: 2,
                      backgroundColor: "background.default",
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Typography variant="subtitle2">Database #{idx + 1}</Typography>
                      <Stack direction="row" spacing={1}>
                        <Chip size="small" label={db.name || `db-${idx + 1}`} />
                        {config.databases.length > 1 ? (
                          <Button size="small" color="error" onClick={() => removeDb(idx)}>
                            Remove
                          </Button>
                        ) : null}
                      </Stack>
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
                      <TextField
                        label="Name"
                        value={db.name}
                        onChange={(e) => handleDbChange(idx, "name", e.target.value)}
                        fullWidth
                      />
                      <TextField
                        label="Type"
                        value={db.type || config.dbType}
                        onChange={(e) => handleDbChange(idx, "type", e.target.value)}
                        fullWidth
                      />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField
                        label="Host"
                        value={db.host}
                        onChange={(e) => handleDbChange(idx, "host", e.target.value)}
                        fullWidth
                      />
                      <TextField
                        label="Port"
                        value={db.port}
                        onChange={(e) => handleDbChange(idx, "port", e.target.value)}
                        fullWidth
                      />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 2 }}>
                      <TextField
                        label="Database"
                        value={db.database}
                        onChange={(e) => handleDbChange(idx, "database", e.target.value)}
                        fullWidth
                      />
                      <TextField
                        label="User"
                        value={db.user}
                        onChange={(e) => handleDbChange(idx, "user", e.target.value)}
                        fullWidth
                      />
                      <TextField
                        label="Password (secret)"
                        value={db.passwordInput}
                        onChange={(e) => handleDbChange(idx, "passwordInput", e.target.value)}
                        type="password"
                        fullWidth
                        helperText="Leave blank to reuse the stored secret."
                      />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 2 }}>
                      <TextField
                        label="Password env var"
                        value={db.password_env}
                        onChange={(e) => handleDbChange(idx, "password_env", e.target.value)}
                        fullWidth
                      />
                      <TextField
                        label="Mode"
                        value={db.mode}
                        onChange={(e) => handleDbChange(idx, "mode", e.target.value)}
                        fullWidth
                      />
                    </Stack>
                  </Box>
                ))}
                <Button variant="outlined" onClick={addDb}>
                  Add database
                </Button>
              </Stack>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionCard
            title="Preview & Actions"
            subtitle="Validate connectivity, generate MCP, and push to registry + desktop."
            action={
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" startIcon={<BoltIcon />} onClick={handleGenerate}>
                  Generate MCP
                </Button>
                <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save to registry"}
                </Button>
              </Stack>
            }
          >
            <Typography variant="subtitle2" gutterBottom>
              Config JSON
            </Typography>
            <Box
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                background: "#0b1120",
                color: "#e2e8f0",
                fontFamily: "monospace",
                p: 2,
                maxHeight: 300,
                overflow: "auto",
              }}
              component="pre"
            >
              {JSON.stringify(preview.config, null, 2)}
            </Box>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Secrets captured (names only)
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
              {Object.keys(preview.secrets || {}).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  None provided yet
                </Typography>
              ) : (
                Object.keys(preview.secrets || {}).map((key) => <Chip key={key} label={key} size="small" />)
              )}
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={1}>
              <Button startIcon={<DownloadIcon />} variant="outlined" onClick={handleDownload}>
                Download desktop config
              </Button>
              <Button variant="outlined">Test DB connectivity</Button>
            </Stack>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
