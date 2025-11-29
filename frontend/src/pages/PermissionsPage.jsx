import { useMemo, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, LinearProgress, Stack, TextField, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SectionCard from "../components/SectionCard.jsx";
import { getPrimeStatus } from "../utils/api.js";

const roles = [
  "roles/run.admin",
  "roles/cloudsql.admin",
  "roles/artifactregistry.reader",
  "roles/secretmanager.secretAccessor",
  "roles/iam.serviceAccountUser",
  "roles/logging.viewer",
];

export default function PermissionsPage() {
  const [saJson, setSaJson] = useState("");
  const [projectId, setProjectId] = useState("");
  const [region, setRegion] = useState("us-central1");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const credentialB64 = useMemo(() => {
    if (!saJson.trim()) return "";
    try {
      return btoa(JSON.stringify(JSON.parse(saJson)));
    } catch {
      return "";
    }
  }, [saJson]);

  const handleRun = async () => {
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

  const missingMap = useMemo(() => {
    if (!result) return {};
    const map = {};
    roles.forEach((role) => {
      map[role] = true; // default ok
    });
    // If prime-status reports needsPriming or errors, mark as missing for visibility.
    if (result.status && result.status !== "primed") {
      roles.forEach((role) => {
        map[role] = false;
      });
    }
    return map;
  }, [result]);

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Permission Verification
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        All deployments flow through TriggerService. Verify the TriggerService service account has the required roles. This uses TriggerService&apos;s prime-status to surface gaps.
      </Typography>

      <SectionCard
        title="Required Roles"
        subtitle="Roles applied to the TriggerService service account."
        action={
          <Button
            variant="outlined"
            size="small"
            startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
            disabled={!credentialB64 || loading}
            onClick={handleRun}
          >
            Re-run check
          </Button>
        }
      >
        <Stack spacing={1.5}>
          <TextField
            label="Service account JSON"
            value={saJson}
            onChange={(e) => setSaJson(e.target.value)}
            multiline
            minRows={3}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Project ID" value={projectId} onChange={(e) => setProjectId(e.target.value)} fullWidth />
            <TextField label="Region" value={region} onChange={(e) => setRegion(e.target.value)} fullWidth />
          </Stack>

          {roles.map((role) => {
            const ok = missingMap[role];
            return (
              <Stack
                key={role}
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}
              >
                <Typography variant="body1">{role}</Typography>
                <Chip
                  size="small"
                  label={ok ? "ok" : "missing"}
                  color={ok ? "success" : "warning"}
                  variant={ok ? "filled" : "outlined"}
                />
              </Stack>
            );
          })}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {result ? (
            <Alert severity={result.status === "primed" ? "success" : "warning"}>
              Prime status: {result.status}. Missing buckets: {result.missing_bucket_count ?? 0}. Missing service accounts:{" "}
              {result.missing_service_account_count ?? 0}.
            </Alert>
          ) : null}
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Auto-fix can grant missing roles if allowed.
            </Typography>
            <LinearProgress variant="determinate" value={result ? (result.status === "primed" ? 100 : 40) : 0} sx={{ borderRadius: 1 }} />
          </Box>
        </Stack>
      </SectionCard>
    </Box>
  );
}
