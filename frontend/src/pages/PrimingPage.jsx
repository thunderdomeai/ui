import { useMemo, useState } from "react";
import {
  Box,
  Button,
  FormControlLabel,
  Grid,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
  Checkbox,
  Alert,
  Chip,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SectionCard from "../components/SectionCard.jsx";
import { primeCustomer, getPrimeStatus } from "../utils/api.js";
import { useServerCredentialStore } from "../hooks/useServerCredentialStore.js";
import PrimeResultsTable from "../components/PrimeResultsTable.jsx";

export default function PrimingPage() {
  const store = useServerCredentialStore("target");
  const [mode, setMode] = useState("new");
  const [form, setForm] = useState({
    instance: "thunderdeployone:us-central1:thunderdome",
    db: "thunderdomecore_ynv_data",
    user: "nishant",
    password: "ReplaceThisSuperPassword!",
    seed: true,
    projectId: "",
    region: "us-central1",
    saJson: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const activeCred = store.activeEntry?.credential;

  const handleChange = (field) => (event) => {
    const value = field === "seed" ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const credentialB64 = useMemo(() => {
    if (!form.saJson.trim()) return "";
    try {
      return btoa(JSON.stringify(JSON.parse(form.saJson)));
    } catch {
      return "";
    }
  }, [form.saJson]);

  const handlePrime = async () => {
    setLoading(true);
    setError("");
    setStatusMsg("");
    try {
      const payload = {
        project_id: form.projectId,
        region: form.region,
        service_account: activeCred || JSON.parse(form.saJson || "{}"),
        include_defaults: true,
        overrides: {
          database_instance: form.instance,
          database_name: form.db,
          database_user: form.user,
          database_password: form.password,
        },
      };
      const data = await primeCustomer(payload);
      setResult(data);
      setStatusMsg(data.has_errors ? "Priming completed with warnings." : "Primed successfully.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async () => {
    setLoading(true);
    setError("");
    setStatusMsg("");
    try {
      const data = await getPrimeStatus({
        credentialB64,
        projectId: form.projectId,
        region: form.region,
      });
      setResult(data);
      setStatusMsg(`Prime status: ${data.status || "unknown"}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Environment Priming
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Perform all pre-deploy steps outside TriggerService: create or validate Cloud SQL instance, DB, user/password, and seed with schema+enhancements. Connectivity is verified via socket before handing off to TriggerService.
      </Typography>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} md={7}>
          <SectionCard
            title="Database Setup"
            subtitle="Choose whether to create a new Cloud SQL instance or attach to an existing one."
            action={
              <Chip
                color="success"
                label="Socket path: /cloudsql/thunderdeployone:us-central1:thunderdome"
                size="small"
              />
            }
          >
            <RadioGroup
              row
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              sx={{ mb: 2 }}
            >
              <FormControlLabel value="new" control={<Radio />} label="Create new instance + DB" />
              <FormControlLabel value="existing" control={<Radio />} label="Use existing instance" />
            </RadioGroup>
            <Stack spacing={2}>
              <TextField
                select
                SelectProps={{ native: true }}
                label="Select stored credential (optional)"
                value={store.selectedId || ""}
                onChange={(e) => store.selectEntry(e.target.value || null)}
              >
                <option value="">—</option>
                {store.entries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </TextField>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Project ID" value={form.projectId} onChange={handleChange("projectId")} fullWidth />
                <TextField label="Region" value={form.region} onChange={handleChange("region")} fullWidth />
              </Stack>
              {!activeCred ? (
                <TextField
                  label="Service account JSON"
                  value={form.saJson}
                  onChange={handleChange("saJson")}
                  multiline
                  minRows={3}
                />
              ) : (
                <Alert severity="info">Using stored credential: {store.activeEntry?.label}</Alert>
              )}
              <TextField label="Instance connection name" value={form.instance} onChange={handleChange("instance")} />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Database name" value={form.db} onChange={handleChange("db")} fullWidth />
                <TextField label="User" value={form.user} onChange={handleChange("user")} fullWidth />
                <TextField
                  label="Password"
                  value={form.password}
                  onChange={handleChange("password")}
                  type="password"
                  fullWidth
                />
              </Stack>
              <FormControlLabel
                control={<Checkbox checked={form.seed} onChange={handleChange("seed")} />}
                label="Run schema.sql + schema_enhancements.sql + seed data"
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  sx={{ alignSelf: "flex-start" }}
                  disabled={!credentialB64 || loading}
                  onClick={handlePrime}
                >
                  Run priming
                </Button>
                <Button variant="outlined" disabled={!credentialB64 || loading} onClick={handleCheck}>
                  Check status
                </Button>
              </Stack>
              {error ? <Alert severity="error">{error}</Alert> : null}
              {statusMsg ? <Alert severity="info">{statusMsg}</Alert> : null}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={5}>
          <SectionCard title="Connectivity" subtitle="Socket-first checks before deploy handoff.">
            <Stack spacing={1}>
              {result ? (
                <>
                  <Alert severity={result.status === "primed" ? "success" : "warning"}>
                    Prime status: {result.status || "unknown"}
                  </Alert>
                  <Alert severity="info">
                    Buckets missing: {result.missing_bucket_count ?? 0} • Service accounts missing:{" "}
                    {result.missing_service_account_count ?? 0}
                  </Alert>
                  <PrimeResultsTable result={result} />
                </>
              ) : (
                <Alert severity="info">Run a priming check to see socket and DB reachability.</Alert>
              )}
            </Stack>
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Once green, TriggerService receives the instance/db/user/password to inject into service env vars (e.g., whatsapphandler points to thunderdome, not core-db).
              </Typography>
            </Box>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
