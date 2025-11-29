import { useMemo, useState, useEffect } from "react";
import { Box, Button, Chip, CircularProgress, Divider, Grid, Paper, Stack, TextField, Typography, Alert } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SectionCard from "../components/SectionCard.jsx";
import { getPrimeStatus } from "../utils/api.js";

const bootstrapScript = `curl -sSL https://get.thunderdome.ai/bootstrap.sh | bash -s -- --project <PROJECT_ID> --region us-central1 --token <SHORT_LIVED_TOKEN>`;

export default function OnboardingPage() {
  const [saJson, setSaJson] = useState("");
  const [projectId, setProjectId] = useState("");
  const [region, setRegion] = useState("us-central1");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [setupScript, setSetupScript] = useState("");
  const [scriptError, setScriptError] = useState("");

  useEffect(() => {
    const loadScript = async () => {
      try {
        const res = await fetch("/create_service_account.sh");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setSetupScript(text);
        setScriptError("");
      } catch (e) {
        setScriptError(e.message || "Failed to load setup script");
      }
    };
    loadScript();
  }, []);

  const credentialB64 = useMemo(() => {
    if (!saJson.trim()) return "";
    try {
      const parsed = JSON.parse(saJson);
      return btoa(JSON.stringify(parsed));
    } catch (e) {
      return "";
    }
  }, [saJson]);

  const handleCheck = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getPrimeStatus({ credentialB64, projectId, region });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Customer Onboarding
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Customers run a lightweight bootstrap script. It authenticates gcloud, runs IAM probes, and sends a short-lived token back to the control plane for TriggerService-driven deployments.
      </Typography>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} md={7}>
          <SectionCard
            title="Bootstrap Script"
            subtitle="Copy/paste to the customer. The script posts status to the control plane."
            action={
              <Button
                variant="outlined"
                size="small"
                startIcon={<ContentCopyIcon />}
                onClick={() => {
                  navigator.clipboard.writeText(bootstrapScript).catch(() => {});
                }}
              >
                Copy
              </Button>
            }
          >
            <Paper
              variant="outlined"
              sx={{ p: 2, background: "#0b1120", color: "#e2e8f0", fontFamily: "monospace", borderRadius: 2 }}
            >
              <Typography variant="body2" component="pre" sx={{ whiteSpace: "pre-wrap", m: 0 }}>
                {bootstrapScript}
              </Typography>
            </Paper>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
              <TextField label="Short-lived token" size="small" fullWidth placeholder="Generated per org" />
              <Button variant="contained" startIcon={<PlayArrowIcon />}>
                Generate token
              </Button>
            </Stack>
          </SectionCard>

          <SectionCard
            title="Customer onboarding script"
            subtitle="Download or copy the setup script customers run to grant permissions."
          >
            {scriptError ? <Alert severity="error">{scriptError}</Alert> : null}
            <Stack spacing={1}>
              <Button
                variant="outlined"
                onClick={() => {
                  if (!setupScript) return;
                  const blob = new Blob([setupScript], { type: "text/bash" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "create_service_account.sh";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                disabled={!setupScript}
              >
                Download script
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  if (!setupScript) return;
                  navigator.clipboard
                    .writeText(setupScript)
                    .catch(() => setScriptError("Failed to copy to clipboard"));
                }}
                disabled={!setupScript}
              >
                Copy to clipboard
              </Button>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={5}>
          <SectionCard title="Live Checks" subtitle="Posted by the bootstrap script.">
            <Stack spacing={1.5}>
              <TextField
                label="Service account JSON"
                value={saJson}
                onChange={(e) => setSaJson(e.target.value)}
                placeholder='{"type":"service_account",...}'
                multiline
                minRows={4}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Project ID" value={projectId} onChange={(e) => setProjectId(e.target.value)} fullWidth />
                <TextField label="Region" value={region} onChange={(e) => setRegion(e.target.value)} fullWidth />
              </Stack>
              <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                disabled={!credentialB64 || loading}
                onClick={handleCheck}
              >
                Run prime-status
              </Button>
              {error ? <Alert severity="error">{error}</Alert> : null}
              {result ? (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Status: <Chip label={result.status || "unknown"} size="small" color={result.status === "primed" ? "success" : "warning"} />
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Buckets missing: {result.missing_bucket_count ?? 0} • Service accounts missing:{" "}
                    {result.missing_service_account_count ?? 0}
                  </Typography>
                </Paper>
              ) : null}
            </Stack>
          </SectionCard>
          <Divider sx={{ my: 2 }} />
          <SectionCard title="Notes" subtitle="TriggerService remains the deploy orchestrator.">
            <Typography variant="body2" color="text.secondary">
              Bootstrap only primes auth and IAM visibility. Deployments remain strictly via TriggerService to keep a single control path.
            </Typography>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
