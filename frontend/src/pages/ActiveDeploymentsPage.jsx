import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { listTenants, listServices } from "../utils/api.js";
import SectionCard from "../components/SectionCard.jsx";
import StatusChip from "../components/StatusChip.jsx";

export default function ActiveDeploymentsPage() {
  const [tenants, setTenants] = useState([]);
  const [servicesByTenant, setServicesByTenant] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const loadTenants = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listTenants();
      const items = data.tenants || data.items || [];
      setTenants(items);
      // Prefetch services for first few tenants
      const serviceMap = {};
      for (const t of items.slice(0, 3)) {
        const id = t.tenant_id || t.id || t.project_id || t;
        try {
          const svcData = await listServices(id);
          serviceMap[id] = svcData.services || svcData.items || [];
        } catch {
          serviceMap[id] = [];
        }
      }
      setServicesByTenant(serviceMap);
    } catch (e) {
      setError(e.message || "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Tenants & Deployments
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Multi-tenant view of deployed services via TriggerService. Drill into a tenant to manage revisions.
      </Typography>

      <SectionCard
        title="Tenants"
        subtitle="Showing discovered tenants from TriggerService."
        action={
          <Button startIcon={<RefreshIcon />} onClick={loadTenants} disabled={loading}>
            Refresh
          </Button>
        }
      >
        {error ? <Alert severity="error">{error}</Alert> : null}
        {loading ? <CircularProgress size={20} /> : null}
        <Grid container spacing={2} sx={{ mt: 1 }}>
          {tenants.map((t) => {
            const id = t.tenant_id || t.id || t.project_id || t;
            const services = servicesByTenant[id] || [];
            return (
              <Grid item xs={12} md={6} key={id}>
                <Card variant="outlined">
                  <CardContent>
                    <Stack spacing={1}>
                      <Typography variant="h6">{id}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Services: {services.length || "—"}
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        {services.slice(0, 4).map((svc) => (
                          <Chip
                            key={svc.service_name || svc.name}
                            label={svc.service_name || svc.name}
                            size="small"
                            icon={<StatusChip status={svc.status || svc.state} />}
                            sx={{ pl: 0.5 }}
                          />
                        ))}
                      </Stack>
                    </Stack>
                  </CardContent>
                  <CardActions>
                    <Button size="small" onClick={() => navigate(`/tenants/${encodeURIComponent(id)}`)}>
                      View details
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            );
          })}
          {tenants.length === 0 && !loading && !error ? (
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary">
                No tenants found.
              </Typography>
            </Grid>
          ) : null}
        </Grid>
      </SectionCard>
    </Box>
  );
}
