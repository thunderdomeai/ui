import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SectionCard from "../components/SectionCard.jsx";
import StatusChip from "../components/StatusChip.jsx";
import { activateServiceRevision, listServiceRevisions, listServices } from "../utils/api.js";

export default function TenantDetailPage() {
  const { tenantId } = useParams();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedService, setSelectedService] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [revLoading, setRevLoading] = useState(false);
  const [revError, setRevError] = useState("");

  const loadServices = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listServices(tenantId);
      setServices(data.services || data.items || []);
    } catch (e) {
      setError(e.message || "Failed to load services");
    } finally {
      setLoading(false);
    }
  };

  const loadRevisions = async (serviceName) => {
    if (!serviceName) return;
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

  const activateRevision = async (serviceName, revision) => {
    setRevLoading(true);
    setRevError("");
    try {
      await activateServiceRevision(tenantId, serviceName, { revision, percent: 100 });
      await loadRevisions(serviceName);
    } catch (e) {
      setRevError(e.message || "Failed to activate revision");
    } finally {
      setRevLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, [tenantId]);

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Tenant: {tenantId}
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        View services and revisions for this tenant. Activation routes through TriggerService.
      </Typography>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <SectionCard
            title="Services"
            subtitle="Services reported by TriggerService for this tenant."
            action={
              <Button startIcon={<RefreshIcon />} onClick={loadServices} disabled={loading}>
                Refresh
              </Button>
            }
          >
            {error ? <Alert severity="error">{error}</Alert> : null}
            {loading ? <CircularProgress size={20} /> : null}
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Service</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>URL</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {services.map((svc) => (
                  <TableRow
                    key={svc.service_name || svc.name}
                    hover
                    selected={selectedService === (svc.service_name || svc.name)}
                    onClick={() => {
                      setSelectedService(svc.service_name || svc.name);
                      loadRevisions(svc.service_name || svc.name);
                    }}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell>{svc.service_name || svc.name}</TableCell>
                    <TableCell>
                      <StatusChip status={svc.status || svc.state} />
                    </TableCell>
                    <TableCell>{svc.url || svc.service_url || "—"}</TableCell>
                  </TableRow>
                ))}
                {services.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} align="center">
                      No services found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionCard
            title={`Revisions ${selectedService ? "for " + selectedService : ""}`}
            subtitle="Activate revisions to shift traffic."
          >
            {revError ? <Alert severity="error">{revError}</Alert> : null}
            {revLoading ? <CircularProgress size={20} /> : null}
            {selectedService ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Revision</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Traffic</TableCell>
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
                      <TableCell>{rev.traffic != null ? `${rev.traffic}%` : "—"}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          startIcon={<PlayArrowIcon />}
                          onClick={() => activateRevision(selectedService, rev.revision || rev.name)}
                        >
                          Activate 100%
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {revisions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} align="center">
                        No revisions found.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Select a service to view revisions.
              </Typography>
            )}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
