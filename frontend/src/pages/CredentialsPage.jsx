import { useState } from "react";
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
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckIcon from "@mui/icons-material/Check";
import SectionCard from "../components/SectionCard.jsx";
import { useServerCredentialStore } from "../hooks/useServerCredentialStore.js";
import { primeCustomer, getPrimeStatus } from "../utils/api.js";
import PrimeResultsTable from "../components/PrimeResultsTable.jsx";

export default function CredentialsPage() {
  const store = useServerCredentialStore("target");
  const [label, setLabel] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [region, setRegion] = useState("us-central1");
  const [primeResult, setPrimeResult] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const addCredential = async () => {
    try {
      const parsed = JSON.parse(jsonText);
      await store.addEntry({ label, credential: parsed });
      setLabel("");
      setJsonText("");
    } catch (e) {
      setError(e.message || "Invalid JSON");
    }
  };

  const handlePrime = async () => {
    if (!store.activeEntry?.credential) {
      setError("Select an active credential first.");
      return;
    }
    setLoading(true);
    setError("");
    setStatusMsg("");
    try {
      const payload = {
        service_account: store.activeEntry.credential,
        project_id: projectId || store.activeEntry.credential.project_id,
        region,
        include_defaults: true,
        extra_buckets: [],
      };
      const data = await primeCustomer(payload);
      setPrimeResult(data);
      setStatusMsg(data.has_errors ? "Primed with warnings." : "Primed successfully.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async () => {
    if (!store.activeEntry?.credential) {
      setError("Select an active credential first.");
      return;
    }
    setLoading(true);
    setError("");
    setStatusMsg("");
    try {
      const credentialB64 = btoa(JSON.stringify(store.activeEntry.credential));
      const data = await getPrimeStatus({
        credentialB64,
        projectId: projectId || store.activeEntry.credential.project_id,
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

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Credentials & Priming
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Persist source/target credentials in the shared bucket and run priming (buckets, service accounts, queues, scheduler jobs) via TriggerService.
      </Typography>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} md={5}>
          <SectionCard title="Add credential" subtitle="Stored in the shared credential bucket.">
            <Stack spacing={1.5}>
              <TextField label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <TextField
                label="Credential JSON"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                multiline
                minRows={4}
              />
              <Button variant="contained" onClick={addCredential}>
                Save credential
              </Button>
              {error ? <Alert severity="error">{error}</Alert> : null}
            </Stack>
          </SectionCard>
          <SectionCard title="Stored credentials" subtitle="Select active target for priming.">
            <List dense>
              {store.entries.map((entry) => (
                <ListItem
                  key={entry.id}
                  secondaryAction={
                    <IconButton edge="end" aria-label="delete" onClick={() => store.removeEntry(entry.id)}>
                      <DeleteIcon />
                    </IconButton>
                  }
                  button
                  selected={store.selectedId === entry.id}
                  onClick={() => store.selectEntry(entry.id)}
                >
                  <ListItemText primary={entry.label} secondary={entry.id} />
                  {store.selectedId === entry.id ? <CheckIcon color="success" /> : null}
                </ListItem>
              ))}
              {store.entries.length === 0 ? (
                <ListItem>
                  <ListItemText primary="No credentials saved." />
                </ListItem>
              ) : null}
            </List>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={7}>
          <SectionCard title="Prime project" subtitle="Creates buckets, service accounts, task queues, scheduler jobs.">
            <Stack spacing={1.5}>
              <TextField label="Project ID" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
              <TextField label="Region" value={region} onChange={(e) => setRegion(e.target.value)} />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={handlePrime} disabled={loading}>
                  Run priming
                </Button>
                <Button variant="outlined" onClick={handleCheck} disabled={loading}>
                  Check status
                </Button>
              </Stack>
              {statusMsg ? <Alert severity="info">{statusMsg}</Alert> : null}
              {error ? <Alert severity="error">{error}</Alert> : null}
              <Divider />
              <PrimeResultsTable result={primeResult} />
            </Stack>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
