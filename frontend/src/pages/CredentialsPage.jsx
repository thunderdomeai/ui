import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
  Tabs,
  Tab,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Tooltip,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import SectionCard from "../components/SectionCard.jsx";
import { useServerCredentialStore } from "../hooks/useServerCredentialStore.js";
import { primeCustomer, getPrimeStatus, verifyCredentialEntry, markCredentialPrimed } from "../utils/api.js";
import PrimeResultsTable from "../components/PrimeResultsTable.jsx";

const STATUS_META = {
  unverified: { label: "Unverified", color: "default" },
  verified: { label: "Verified", color: "warning" },
  primed: { label: "Primed", color: "success" },
};

function StatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unverified;
  return <Chip size="small" color={meta.color} label={meta.label} />;
}

export default function CredentialsPage() {
  const [tab, setTab] = useState("target");
  const sourceStore = useServerCredentialStore("source");
  const targetStore = useServerCredentialStore("target");
  const store = tab === "source" ? sourceStore : targetStore;

  const [label, setLabel] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [region, setRegion] = useState("us-central1");
  const [primeResult, setPrimeResult] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusEntryId, setFocusEntryId] = useState("");

  const activeSource = sourceStore.activeEntry;
  const activeTarget = targetStore.activeEntry;

  const workingEntry = useMemo(
    () => store.entries.find((e) => e.id === focusEntryId) || null,
    [store.entries, focusEntryId]
  );
  const workingStatus = workingEntry?.status || "unverified";
  const workingProjectId = projectId || workingEntry?.projectId || workingEntry?.credential?.project_id || "";
  const uniqueProjects = useMemo(() => {
    const items = store.entries
      .map((e) => e?.projectId || e?.credential?.project_id)
      .filter(Boolean);
    return [...new Set(items)];
  }, [store.entries]);

  useEffect(() => {
    if (!store.entries.length) {
      setFocusEntryId("");
      return;
    }
    if (!focusEntryId || !store.entries.find((e) => e.id === focusEntryId)) {
      setFocusEntryId(store.entries[0].id);
    }
  }, [store.entries, focusEntryId, tab]);

  useEffect(() => {
    const entry = store.entries.find((e) => e.id === focusEntryId);
    if (entry?.projectId) {
      setProjectId(entry.projectId);
    }
  }, [focusEntryId, store.entries]);

  const addCredential = async () => {
    try {
      const parsed = JSON.parse(jsonText);
      const saved = await store.addEntry({ label, credential: parsed });
      setLabel("");
      setJsonText("");
      if (saved?.id) {
        setFocusEntryId(saved.id);
      }
    } catch (e) {
      setError(e.message || "Invalid JSON");
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      JSON.parse(text); // validate early
      setJsonText(text);
      if (!label) {
        const baseName = file.name.replace(/\.[^.]+$/, "");
        setLabel(baseName);
      }
      setError("");
    } catch (e) {
      setError(e.message || "Invalid JSON file");
    }
  };

  const handleVerify = async () => {
    if (!workingEntry) {
      setError("Select a credential to verify.");
      return;
    }
    if (!workingProjectId) {
      setError("Project ID is required to verify.");
      return;
    }
    if (!workingEntry.credential) {
      setError("Selected credential JSON is missing.");
      return;
    }
    setLoading(true);
    setError("");
    setStatusMsg("");
    try {
      setPrimeResult(null);
      const data = await verifyCredentialEntry(tab, workingEntry.id, {
        project_id: workingProjectId,
        region,
      });
      setVerifyResult(data.prime_status || null);
      setStatusMsg("Credential verified. You can prime next.");
      await store.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePrime = async () => {
    if (!workingEntry) {
      setError("Select a credential to prime.");
      return;
    }
    if (!workingProjectId) {
      setError("Project ID is required to prime.");
      return;
    }
    if (!workingEntry.credential) {
      setError("Selected credential JSON is missing.");
      return;
    }
    if (workingStatus !== "verified" && workingStatus !== "primed") {
      setError("Run readiness verification before priming.");
      return;
    }
    setLoading(true);
    setError("");
    setStatusMsg("");
    try {
      setVerifyResult(null);
      const payload = {
        service_account: workingEntry.credential,
        project_id: workingProjectId,
        region,
        include_defaults: true,
        extra_buckets: [],
      };
      const data = await primeCustomer(payload);
      setPrimeResult(data);
      setStatusMsg(data.has_errors ? "Primed with warnings." : "Primed successfully.");
      await markCredentialPrimed(tab, workingEntry.id, { prime_result: data });
      await store.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async () => {
    if (!workingEntry) {
      setError("Select a credential to check.");
      return;
    }
    if (!workingProjectId) {
      setError("Project ID is required to check status.");
      return;
    }
    if (!workingEntry.credential) {
      setError("Selected credential JSON is missing.");
      return;
    }
    setLoading(true);
    setError("");
    setStatusMsg("");
    try {
      setVerifyResult(null);
      const credentialB64 = btoa(JSON.stringify(workingEntry.credential));
      const data = await getPrimeStatus({
        credentialB64,
        projectId: workingProjectId,
        region,
      });
      setPrimeResult(data);
      setStatusMsg(`Prime status: ${data.status || "unknown"}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const statusSummary = (entry) => {
    if (!entry) return "None";
    const meta = STATUS_META[entry.status] || STATUS_META.unverified;
    return `${entry.label} (${meta.label})`;
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Credentials, Verification, and Priming
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Upload source/target service accounts, verify permissions, prime the project (customer target or provider/source), then activate (verified sources or primed targets) for deploys and monitoring.
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "flex-start", sm: "center" }}>
          <span>Active source:</span>
          <Chip
            label={statusSummary(activeSource)}
            color={activeSource?.status === "primed" ? "success" : "default"}
            size="small"
          />
          <span>Active target:</span>
          <Chip
            label={statusSummary(activeTarget)}
            color={activeTarget?.status === "primed" ? "success" : "default"}
            size="small"
          />
          <Typography variant="body2" color="text.secondary">
            Targets must be primed; sources can be activated once verified. Deploy/monitor pages require an active source + target.
          </Typography>
        </Stack>
      </Alert>

      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tabs value={tab} onChange={(e, newValue) => setTab(newValue)}>
          <Tab label="Target Credentials (Customer)" value="target" />
          <Tab label="Source Credentials (Deployer)" value="source" />
        </Tabs>
      </Box>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} md={5}>
          <SectionCard
            title={`Add ${tab} credential`}
            subtitle={`Stored in the shared credential bucket for ${tab}. Verify -> prime -> activate.`}
          >
            <Stack spacing={1.5}>
              <Button variant="outlined" component="label">
                Upload JSON file
                <input type="file" accept="application/json,.json" hidden onChange={handleFileUpload} />
              </Button>
              <TextField label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <TextField
                label="Credential JSON"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                multiline
                minRows={4}
              />
              <Button variant="contained" onClick={addCredential}>
                Save {tab} credential
              </Button>
              {error ? <Alert severity="error">{error}</Alert> : null}
            </Stack>
          </SectionCard>
          <SectionCard
            title={`Stored ${tab} credentials`}
            subtitle="Verify sources or prime targets, then activate."
          >
            <List dense>
              {store.entries.map((entry) => {
                const isActive = store.selectedId === entry.id;
                const isPrimed = entry.status === "primed";
                return (
                  <ListItem
                    key={entry.id}
                    secondaryAction={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <StatusChip status={entry.status} />
                        <Button size="small" variant="text" onClick={() => setFocusEntryId(entry.id)}>
                          Ready check
                        </Button>
                        {isActive ? (
                          <Chip size="small" color="success" label="Active" />
                        ) : (
                          <Tooltip title={isPrimed || entry.status === "verified" ? "Activate this credential." : "Verify (source) or prime (target) before activation."}>
                            <span>
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={!(isPrimed || entry.status === "verified")}
                                onClick={() => store.selectEntry(entry.id)}
                              >
                                Activate
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                        <IconButton edge="end" aria-label="delete" onClick={() => store.removeEntry(entry.id)}>
                          <DeleteIcon />
                        </IconButton>
                      </Stack>
                    }
                  >
                    <ListItemText
                      primary={entry.label}
                      secondary={entry.projectId ? `Project: ${entry.projectId}` : entry.id}
                    />
                  </ListItem>
                );
              })}
              {store.entries.length === 0 ? (
                <ListItem>
                  <ListItemText primary="No credentials saved." />
                </ListItem>
              ) : null}
            </List>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={7}>
          <SectionCard
            title="Readiness + priming"
            subtitle="Step 1: verify permissions. Step 2: prime (target or provider). Step 3: activate (verified sources or primed targets)."
          >
            <Stack spacing={1.5}>
              <FormControl fullWidth>
                <InputLabel id="entry-select-label">Credential to verify</InputLabel>
                <Select
                  labelId="entry-select-label"
                  value={focusEntryId}
                  label="Credential to verify"
                  onChange={(e) => setFocusEntryId(e.target.value)}
                  disabled={!store.entries.length}
                >
                  {store.entries.map((entry) => (
                    <MenuItem key={entry.id} value={entry.id}>
                      {entry.label} ({STATUS_META[entry.status]?.label || "Unverified"})
                    </MenuItem>
                  ))}
                  {!store.entries.length ? (
                    <MenuItem value="">
                      <em>Add a credential to begin</em>
                    </MenuItem>
                  ) : null}
                </Select>
              </FormControl>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  Status:
                </Typography>
                <StatusChip status={workingStatus} />
                {workingEntry?.verifiedAt ? (
                  <Chip
                    size="small"
                    label={`Verified at ${new Date(workingEntry.verifiedAt).toLocaleString()}`}
                    color="default"
                  />
                ) : null}
                {workingEntry?.primedAt ? (
                  <Chip
                    size="small"
                    label={`Primed at ${new Date(workingEntry.primedAt).toLocaleString()}`}
                    color="success"
                    variant="outlined"
                  />
                ) : null}
              </Stack>

              <FormControl fullWidth>
                <InputLabel id="project-select-label">Project ID</InputLabel>
                <Select
                  labelId="project-select-label"
                  value={workingProjectId}
                  label="Project ID"
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={!store.entries.length}
                >
                  {uniqueProjects.map((pid) => (
                    <MenuItem key={pid} value={pid}>
                      {pid}
                    </MenuItem>
                  ))}
                  {uniqueProjects.length === 0 ? (
                    <MenuItem value="">
                      <em>Add a credential to auto-fill project</em>
                    </MenuItem>
                  ) : null}
                </Select>
              </FormControl>
              <TextField label="Region" value={region} onChange={(e) => setRegion(e.target.value)} />

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button variant="outlined" onClick={handleVerify} disabled={loading || !workingEntry}>
                  Run readiness check
                </Button>
                <Button variant="outlined" onClick={handleCheck} disabled={loading || !workingEntry}>
                  Check status
                </Button>
                <Button
                  variant="contained"
                  onClick={handlePrime}
                  disabled={loading || !workingEntry || workingStatus === "unverified"}
                >
                  Prime project
                </Button>
              </Stack>

              {statusMsg ? <Alert severity="info">{statusMsg}</Alert> : null}
              {error ? <Alert severity="error">{error}</Alert> : null}
              <Divider />
              <PrimeResultsTable result={primeResult || verifyResult} />
            </Stack>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
