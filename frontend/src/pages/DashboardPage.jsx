import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import SectionCard from "../components/SectionCard.jsx";
import StatusChip from "../components/StatusChip.jsx";
import {
  activateServiceRevision,
  getJob,
  listJobs,
  listServiceRevisions,
  listServices,
  listTenants,
  saveConfigFromJob,
} from "../utils/api.js";
import LogsViewer from "../components/LogsViewer.jsx";
import { useServerCredentialStore } from "../hooks/useServerCredentialStore.js";
import { useCredentialStoreBridge } from "../hooks/credentials/useCredentialStores.js";

const POLL_INTERVAL = 15000;

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function DashboardPage() {
  const [filters, setFilters] = useState({
    tenant_id: "",
    status: "",
    search: "",
  });
  const [jobs, setJobs] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [revDialogOpen, setRevDialogOpen] = useState(false);
  const [revLoading, setRevLoading] = useState(false);
  const [revError, setRevError] = useState("");
  const [logsOpen, setLogsOpen] = useState(false);
  const [logJob, setLogJob] = useState(null);
  const [reuseLoadingId, setReuseLoadingId] = useState("");
  const [reuseStatus, setReuseStatus] = useState("");
  const [reuseError, setReuseError] = useState("");
  const targetStore = useServerCredentialStore("target");
  const credentialBridge = useCredentialStoreBridge();
  const readyForMonitoring = credentialBridge.hasAllActive;

  const fetchTenants = useCallback(async () => {
    try {
      const data = await listTenants();
      const items = data.tenants || data.items || [];
      setTenants(items);
    } catch (e) {
      console.warn("Failed to load tenants", e);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listJobs(filters);
      const arr = data.jobs || data.items || [];
      setJobs(arr);
    } catch (e) {
      setError(e.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  useEffect(() => {
    fetchJobs();
    const id = setInterval(fetchJobs, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchJobs]);

  const handleFilterChange = (key) => (event) => {
    setFilters((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const openJob = async (job) => {
    if (!job || !job.job_identifier) return;
    setReuseStatus("");
    setReuseError("");
    try {
      const detail = await getJob(job.job_identifier);
      setSelectedJob(detail.job || job);
    } catch (e) {
      setSelectedJob(job);
    }
  };

  const openLogs = (job) => {
    setLogJob(job);
    setLogsOpen(true);
  };

  const jobIdentifier = (job) => job?.job_identifier || job?.job_key || job?.job_execution_name || job?.instance_id;

  const reuseJobConfig = async (job) => {
    const jobId = jobIdentifier(job);
    if (!jobId) return;
    setReuseLoadingId(jobId);
    setReuseStatus("");
    setReuseError("");
    const tenantId = job?.tenant_id || job?.client_project || job?.project_id || "unknown";
    const serviceName = job?.service_name || job?.service || job?.instance_id || "service";
    try {
      const resp = await saveConfigFromJob({
        job_id: jobId,
        name: `${serviceName} • ${tenantId}`,
        description: `Imported from job ${jobId}`,
      });
      setReuseStatus(`Saved deploy config from job ${jobId} (${resp?.id || "ok"})`);
    } catch (e) {
      setReuseError(e.message || "Failed to reuse job config");
    } finally {
      setReuseLoadingId("");
    }
  };

  const openRevisions = async (job) => {
    const tenantId = job.tenant_id || job.client_project || job.project_id;
    const serviceName = job.service_name || job.service;
    if (!tenantId || !serviceName) {
      setRevError("Missing tenant or service name.");
      setRevDialogOpen(true);
      return;
    }
    setRevDialogOpen(true);
    setRevLoading(true);
    setRevError("");
    try {
      const data = await listServiceRevisions(tenantId, serviceName);
      setRevisions(data.revisions || []);
    } catch (e) {
      setRevError(e.message || "Failed to load revisions");
    } finally {
      setRevLoading(false);
    }
  };

  const activateRevision = async (tenantId, serviceName, revision) => {
    setRevLoading(true);
    setRevError("");
    try {
      await activateServiceRevision(tenantId, serviceName, { revision, percent: 100 });
      const data = await listServiceRevisions(tenantId, serviceName);
      setRevisions(data.revisions || []);
    } catch (e) {
      setRevError(e.message || "Failed to activate revision");
    } finally {
      setRevLoading(false);
    }
  };

  const tenantOptions = useMemo(() => {
    return tenants.map((t) => t.tenant_id || t.id || t.project_id || t);
  }, [tenants]);

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Deployment Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Multi-tenant job view powered by TriggerService. Monitor jobs, inspect details, and manage service revisions.
      </Typography>
      {!readyForMonitoring ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Activate primed source and target credentials on the Credentials page before using dashboard or logs.
        </Alert>
      ) : null}

      <SectionCard
        title="Filters"
        subtitle="Scope jobs by tenant, status, or search."
        action={
          <Button startIcon={<RefreshIcon />} onClick={fetchJobs} disabled={loading}>
            Refresh
          </Button>
        }
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField
            label="Tenant"
            select
            value={filters.tenant_id}
            onChange={handleFilterChange("tenant_id")}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">All</MenuItem>
            {tenantOptions.map((opt) => (
              <MenuItem key={opt} value={opt}>
                {opt}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Status"
            select
            value={filters.status}
            onChange={handleFilterChange("status")}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="running">Running</MenuItem>
            <MenuItem value="completed">Completed</MenuItem>
            <MenuItem value="failed">Failed</MenuItem>
          </TextField>
          <TextField
            label="Search"
            value={filters.search}
            onChange={handleFilterChange("search")}
            sx={{ minWidth: 200 }}
            placeholder="instance id / service / job id"
          />
        </Stack>
      </SectionCard>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} md={8}>
          <SectionCard
            title="Jobs"
            subtitle={`Showing ${jobs.length} item(s)`}
            action={
              loading ? <CircularProgress size={18} /> : <Chip label="Live" color="success" size="small" />
            }
          >
            {error ? <Alert severity="error">{error}</Alert> : null}
            {reuseStatus ? <Alert severity="success">{reuseStatus}</Alert> : null}
            {reuseError ? <Alert severity="error">{reuseError}</Alert> : null}
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Job</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Tenant</TableCell>
                    <TableCell>Service</TableCell>
                    <TableCell>Updated</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.map((job, idx) => {
                    const tenantId = job.tenant_id || job.client_project || job.project_id;
                    const service = job.service_name || job.service || job.instance_id;
                    const rowKey = job.job_identifier || job.id || job.instance_id || job.job_execution_name || `job-${idx}`;
                    return (
                      <TableRow key={rowKey}>
                        <TableCell>
                          <Tooltip title={job.job_identifier || ""}>
                            <span>{job.instance_id || job.job_identifier}</span>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <StatusChip status={job.status_overall_job_execution || job.status} />
                        </TableCell>
                        <TableCell>{tenantId || "—"}</TableCell>
                        <TableCell>{service || "—"}</TableCell>
                        <TableCell>{formatDate(job.updated_at || job.last_update || job.timestamp)}</TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              startIcon={<SaveAltIcon />}
                              onClick={() => reuseJobConfig(job)}
                              disabled={reuseLoadingId === jobIdentifier(job)}
                            >
                              {reuseLoadingId === jobIdentifier(job) ? "Saving..." : "Reuse"}
                            </Button>
                            <Button size="small" onClick={() => openJob(job)}>
                              Details
                            </Button>
                            <Button size="small" onClick={() => openRevisions(job)}>
                              Revisions
                            </Button>
                            <Button size="small" onClick={() => openLogs(job)}>
                              Logs
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {jobs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        {loading ? <CircularProgress size={20} /> : "No jobs found."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={4}>
          <SectionCard title="Selected job" subtitle="Inspect job metadata and recent events.">
            {!selectedJob ? (
              <Typography variant="body2" color="text.secondary">
                Select a job to view details.
              </Typography>
            ) : (
              <Stack spacing={1}>
                <Typography variant="subtitle1">{selectedJob.instance_id || selectedJob.job_identifier}</Typography>
                <Chip
                  label={selectedJob.status_overall_job_execution || selectedJob.status || "unknown"}
                  color="primary"
                  size="small"
                />
                <Typography variant="body2" color="text.secondary">
                  Tenant: {selectedJob.tenant_id || selectedJob.client_project || "—"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Service: {selectedJob.service_name || selectedJob.service || "—"}
                </Typography>
                {reuseStatus ? <Alert severity="success">{reuseStatus}</Alert> : null}
                {reuseError ? <Alert severity="error">{reuseError}</Alert> : null}
                <Button
                  size="small"
                  startIcon={<SaveAltIcon />}
                  variant="outlined"
                  onClick={() => reuseJobConfig(selectedJob)}
                  disabled={reuseLoadingId === jobIdentifier(selectedJob)}
                >
                  {reuseLoadingId === jobIdentifier(selectedJob) ? "Saving..." : "Reuse job config"}
                </Button>
                <Divider />
                <Typography variant="subtitle2">Events</Typography>
                <List dense>
                  {(selectedJob.events || []).map((evt, idx) => (
                    <ListItem key={idx}>
                      <ListItemText
                        primary={evt.message || evt.status || "event"}
                        secondary={formatDate(evt.timestamp)}
                      />
                    </ListItem>
                  ))}
                  {(selectedJob.events || []).length === 0 ? (
                    <ListItem>
                      <ListItemText primary="No events reported." />
                    </ListItem>
                  ) : null}
                </List>
              </Stack>
            )}
          </SectionCard>
        </Grid>
      </Grid>

      <Dialog open={revDialogOpen} onClose={() => setRevDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Service revisions</DialogTitle>
        <DialogContent dividers>
          {revError ? <Alert severity="error">{revError}</Alert> : null}
          {revLoading ? (
            <Box display="flex" justifyContent="center" py={2}>
              <CircularProgress />
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Revision</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Ready</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {revisions.map((rev) => (
                  <TableRow key={rev.revision || rev.name}>
                    <TableCell>{rev.revision || rev.name}</TableCell>
                    <TableCell>
                      <StatusChip status={rev.status || rev.state || (rev.traffic > 0 ? "healthy" : "pending")} />
                    </TableCell>
                    <TableCell>{formatDate(rev.created_at || rev.created)}</TableCell>
                    <TableCell>{rev.ready ? "Yes" : "No"}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        startIcon={<PlayArrowIcon />}
                        onClick={() => {
                          const t = selectedJob?.tenant_id || selectedJob?.client_project || selectedJob?.project_id;
                          const s = selectedJob?.service_name || selectedJob?.service;
                          if (t && s) activateRevision(t, s, rev.revision || rev.name);
                        }}
                      >
                        Activate 100%
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {revisions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      No revisions found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button startIcon={<RestartAltIcon />} onClick={() => openRevisions(selectedJob || {})}>
            Reload
          </Button>
          <Button onClick={() => setRevDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      <LogsViewer
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        job={logJob}
        targetCredential={targetStore.activeEntry}
      />
    </Box>
  );
}
