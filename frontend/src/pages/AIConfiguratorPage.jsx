import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
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

const defaultConfig = {
  brokerUrl: "https://broker.example.com",
  agentId: "agent-one",
  apiKeyEnv: "BROKER_API_KEY",
  pingInterval: 30000,
  dbType: "PostgreSQL",
  dbHost: "127.0.0.1",
  dbPort: "5432",
  dbName: "thunderdomecore_ynv_data",
  dbUser: "nishant",
  dbPassword: "ReplaceThisSuperPassword!",
};

export default function AIConfiguratorPage() {
  const [config, setConfig] = useState(defaultConfig);
  const [status, setStatus] = useState(null);

  const preview = useMemo(
    () => ({
      broker: {
        url: config.brokerUrl,
        agent_id: config.agentId,
        api_key_env: config.apiKeyEnv,
        ping_interval_ms: Number(config.pingInterval) || 30000,
      },
      databases: [
        {
          type: config.dbType,
          host: config.dbHost,
          port: config.dbPort,
          dbname: config.dbName,
          user: config.dbUser,
          password_env: "DB_PASSWORD",
        },
      ],
      log: { level: "info", audit_file: "logs/trace.log" },
    }),
    [config]
  );

  const handleChange = (field) => (event) => {
    setConfig((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleGenerate = () => {
    setStatus("Config generated. Ready to push to MCP registry and desktop app.");
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        AI Q/A Agent Configurator
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Borrowed from the Agent One (sapb1) configurator and embedded here. Guides the customer through broker settings and DB connectivity, then generates an MCP definition for the desktop app.
      </Typography>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} md={6}>
          <SectionCard title="Broker + Agent" subtitle="Matches the sapb1 configurator contract.">
            <Stack spacing={2}>
              <TextField label="Broker URL" value={config.brokerUrl} onChange={handleChange("brokerUrl")} />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Agent ID" value={config.agentId} onChange={handleChange("agentId")} fullWidth />
                <TextField label="Broker API Key Env" value={config.apiKeyEnv} onChange={handleChange("apiKeyEnv")} fullWidth />
              </Stack>
              <TextField
                label="Ping interval (ms)"
                value={config.pingInterval}
                onChange={handleChange("pingInterval")}
                type="number"
              />
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
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Host" value={config.dbHost} onChange={handleChange("dbHost")} fullWidth />
                <TextField label="Port" value={config.dbPort} onChange={handleChange("dbPort")} fullWidth />
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Database" value={config.dbName} onChange={handleChange("dbName")} fullWidth />
                <TextField label="User" value={config.dbUser} onChange={handleChange("dbUser")} fullWidth />
                <TextField
                  label="Password"
                  value={config.dbPassword}
                  onChange={handleChange("dbPassword")}
                  type="password"
                  fullWidth
                />
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
                <Button variant="contained" startIcon={<SaveIcon />}>
                  Save to registry
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
              {JSON.stringify(preview, null, 2)}
            </Box>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={1}>
              <Button startIcon={<DownloadIcon />} variant="outlined">
                Download desktop config
              </Button>
              <Button variant="outlined">Test DB connectivity</Button>
            </Stack>
            {status ? (
              <Alert severity="success" sx={{ mt: 2 }}>
                {status}
              </Alert>
            ) : null}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
