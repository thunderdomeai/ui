import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Link,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PageLayout from "../components/PageLayout.jsx";
import SectionCard from "../components/SectionCard.jsx";
import TenantProvisioningForm from "../components/TenantProvisioningForm.jsx";
import { useCredentialStore } from "../hooks/credentials/useCredentialStores.js";
import { fetchProviderHealth } from "../utils/api.js";

function ChecklistItem({ label, done }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
      <Box
        sx={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          backgroundColor: done ? "success.main" : "grey.400",
        }}
      />
      <Typography variant="body2" color={done ? "text.primary" : "text.secondary"}>
        {label}
      </Typography>
    </Stack>
  );
}

export default function TenantSetupPage() {
  const sourceStore = useCredentialStore("source");
  const targetStore = useCredentialStore("target");

  const [step, setStep] = useState(0);
  const [providerHealth, setProviderHealth] = useState(null);
  const [providerHealthLoading, setProviderHealthLoading] = useState(false);
  const [providerHealthError, setProviderHealthError] = useState("");

  const activeSource = useMemo(
    () => sourceStore.entries.find((entry) => entry.id === sourceStore.selectedId) ?? null,
    [sourceStore.entries, sourceStore.selectedId],
  );
  const activeTarget = useMemo(
    () => targetStore.entries.find((entry) => entry.id === targetStore.selectedId) ?? null,
    [targetStore.entries, targetStore.selectedId],
  );

  const refreshProviderHealth = useCallback(async () => {
    setProviderHealthLoading(true);
    setProviderHealthError("");
    try {
      const data = await fetchProviderHealth();
      setProviderHealth(data);
    } catch (err) {
      setProviderHealthError(err.message || "Failed to load provider health.");
    } finally {
      setProviderHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProviderHealth();
  }, [refreshProviderHealth]);

  const overallStatus = (providerHealth?.overall_status || "").toLowerCase();
  const providerBlocked = overallStatus === "error";
  const providerHealthy = overallStatus === "ok" || overallStatus === "success";
  const canStartProvisioning = providerHealthy && !!activeSource && !!activeTarget;

  return (
    <PageLayout
      title="Tenant Setup"
      subtitle="Onboard customer projects and deploy the full 10-agent tenant stack with a guided flow."
    >
      <SectionCard
        title="Tenant Onboarding Wizard"
        subtitle="Use this after the provider project is fully set up."
      >
        <Stack spacing={2}>
          <Stepper activeStep={step} alternativeLabel>
            <Step>
              <StepLabel>Prerequisites</StepLabel>
            </Step>
            <Step>
              <StepLabel>Configure & provision tenant</StepLabel>
            </Step>
            <Step>
              <StepLabel>Monitor & operate</StepLabel>
            </Step>
          </Stepper>

          {step === 0 && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Step 1: Prerequisites
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                This step ensures the provider project is healthy (TriggerService, DB, core infra) and that provider (source)
                and tenant (target) credentials are selected.
              </Typography>

              {providerHealthLoading ? (
                <Alert severity="info">Checking provider setup…</Alert>
              ) : providerHealthError ? (
                <Alert severity="warning">{providerHealthError}</Alert>
              ) : providerBlocked ? (
                <Alert severity="error">
                  Provider setup is blocking tenant provisioning. Fix issues on Provider Setup, Deploy, or Health pages.
                </Alert>
              ) : providerHealthy ? (
                <Alert severity="success">Provider looks healthy. You can start tenant provisioning.</Alert>
              ) : (
                <Alert severity="warning">
                  Provider has warnings. You can proceed, but monitor job outcomes closely.
                </Alert>
              )}

              <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Checklist
                </Typography>
                <ChecklistItem
                  label={`Provider credential selected (${activeSource?.label || "none"})`}
                  done={!!activeSource}
                />
                <ChecklistItem
                  label={`Tenant credential selected (${activeTarget?.label || "none"})`}
                  done={!!activeTarget}
                />
                <ChecklistItem label="Provider health not blocking" done={!providerBlocked} />
              </Paper>

              <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 2 }}>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={refreshProviderHealth}
                  disabled={providerHealthLoading}
                >
                  Refresh
                </Button>
                <Button
                  variant="contained"
                  onClick={() => setStep(1)}
                  disabled={!canStartProvisioning}
                >
                  Continue
                </Button>
              </Stack>
              {!canStartProvisioning && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                  Tip: Ensure provider health is OK and credentials are selected on the Credentials page, then refresh.
                </Typography>
              )}
            </Box>
          )}

          {step === 1 && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Step 2: Configure & provision tenant
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                In this step, select the shared Cloud SQL instance and a tenant database, choose a configuration source, and
                submit a 10-agent deployment via TriggerService.
              </Typography>

              <TenantProvisioningForm
                serviceAccount={activeSource?.credential || null}
                customerServiceAccount={activeTarget?.credential || null}
                providerHealth={providerHealth}
              />

              <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 2 }}>
                <Button variant="outlined" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button variant="contained" onClick={() => setStep(2)}>
                  Next: Monitor
                </Button>
              </Stack>
            </Box>
          )}

          {step === 2 && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Step 3: Monitor & operate
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                After submitting a tenant stack deployment:
                <br />
                • Use the Deployment Dashboard to view job history and soft/hard failures.
                <br />
                • Use the Tenants view to see deployed services and revisions.
                <br />
                • Use the Health dashboard to confirm services are READY and healthy.
              </Typography>
              <Stack spacing={1.5}>
                <Button variant="outlined" href="/dashboard">
                  Open Deployment Dashboard
                </Button>
                <Button variant="outlined" href="/tenants">
                  Open Tenants & Deployments
                </Button>
                <Button variant="outlined" href="/health">
                  Open Health Dashboard
                </Button>
              </Stack>
              <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
                <Button variant="outlined" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button variant="contained" onClick={() => setStep(0)}>
                  Start another tenant
                </Button>
              </Stack>
            </Box>
          )}
        </Stack>
      </SectionCard>
    </PageLayout>
  );
}
