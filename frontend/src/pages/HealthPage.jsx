import { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import SectionCard from "../components/SectionCard.jsx";
import StatusChip from "../components/StatusChip.jsx";
import { listServices, listTenants } from "../utils/api.js";

export default function HealthPage() {
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState("");
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await listTenants();
        const arr = data.tenants || data.items || [];
        setTenants(arr);
        if (arr.length > 0) {
          setTenantId(arr[0].tenant_id || arr[0].id || arr[0]);
        }
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await listServices(tenantId);
        const arr = data.services || data.items || [];
        setServices(arr);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId]);

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Health Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Single pane for customer + provider. Feeds from TriggerService events plus active probes (HTTP /health + DB reachability + Monitoring metrics).
      </Typography>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} md={8}>
          <SectionCard
            title="Service Status"
            subtitle="Live view with revision and SLI snapshots."
            action={
              <Autocomplete
                size="small"
                options={tenants.map((t) => t.tenant_id || t.id || t)}
                value={tenantId}
                onChange={(_, value) => setTenantId(value || "")}
                sx={{ width: 240 }}
                renderInput={(params) => <TextField {...params} label="Tenant" />}
              />
            }
          >
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Paper variant="outlined" sx={{ overflow: "hidden", mt: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Service</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Revision</TableCell>
                    <TableCell>URL</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {services.map((svc) => (
                    <TableRow key={svc.service_name || svc.name}>
                      <TableCell>{svc.service_name || svc.name}</TableCell>
                      <TableCell>
                        <StatusChip status={svc.status || svc.state || "unknown"} />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={svc.active_revision || svc.revision || "n/a"} />
                      </TableCell>
                      <TableCell>{svc.url || svc.service_url || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {services.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        {loading ? <LinearProgress /> : <Typography>No services yet.</Typography>}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Paper>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={4}>
          <SectionCard title="Signals" subtitle="Collected by Control Plane + Monitoring API.">
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  HTTP health probes
                </Typography>
                <LinearProgress variant="determinate" value={services.length ? 100 : 10} />
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  DB socket reachability
                </Typography>
                <LinearProgress variant="determinate" value={services.length ? 100 : 10} color="success" />
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Error rate budget
                </Typography>
                <LinearProgress variant="determinate" value={5} color="success" />
              </Box>
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" color="text.secondary">
              Webhooks from TriggerService update deployment events. Collectors run periodic probes and flip status to Degraded/Down when checks fail, even if last deploy succeeded.
            </Typography>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
