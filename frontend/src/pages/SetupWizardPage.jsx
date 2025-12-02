import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Grid,
  Link,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
  FormControlLabel,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import PageLayout from "../components/PageLayout.jsx";
import SectionCard from "../components/SectionCard.jsx";
import TenantProvisioningForm from "../components/TenantProvisioningForm.jsx";
import { useCredentialStore } from "../hooks/credentials/useCredentialStores.js";
import {
  fetchProviderHealth,
  bootstrapProvider,
  runMassDeploy,
} from "../utils/api.js";

export default function SetupWizardPage() {
  const sourceStore = useCredentialStore("source");
  const targetStore = useCredentialStore("target");

  const [providerHealth, setProviderHealth] = useState(null);
  const [providerHealthLoading, setProviderHealthLoading] = useState(false);
  const [providerHealthError, setProviderHealthError] = useState("");

  const [providerStep, setProviderStep] = useState(0);
  const [providerBootstrapLoading, setProviderBootstrapLoading] = useState(false);
  const [providerBootstrapResult, setProviderBootstrapResult] = useState(null);
  const [providerBootstrapError, setProviderBootstrapError] = useState("");

  const [massDeployLoading, setMassDeployLoading] = useState(false);
  const [massDeployResult, setMassDeployResult] = useState(null);
  const [massDeployError, setMassDeployError] = useState("");
  const [massDeployDryRun, setMassDeployDryRun] = useState(true);
  const [massDeployIncludeSchedulers, setMassDeployIncludeSchedulers] = useState(false);

  const [tenantStep, setTenantStep] = useState(0);

  const activeSourceCredential = useMemo(
    () => sourceStore.entries.find((entry) => entry.id === sourceStore.selectedId) ?? null,
    [sourceStore.entries, sourceStore.selectedId],
  );
  const activeTargetCredential = useMemo(
    () => targetStore.entries.find((entry) => entry.id === targetStore.selectedId) ?? null,
    [targetStore.entries, targetStore.selectedId],
  );

  const providerProjectId = useMemo(
    () =>
      activeSourceCredential?.projectId ||
      activeSourceCredential?.credential?.project_id ||
      providerHealth?.source_credential?.projectId ||
      "",
    [activeSourceCredential, providerHealth],
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

  const providerOverallStatus = (providerHealth?.overall_status || "").toLowerCase();
  const providerBlocked = providerOverallStatus === "error";
  const providerHealthy = providerOverallStatus === "ok" || providerOverallStatus === "success";

  const providerCredentialsReady =
    !!activeSourceCredential &&
    !!activeTargetCredential &&
    (providerHealth?.source_credential?.status || "").toLowerCase() !== "";

  const providerBootstrapDone = !!providerBootstrapResult;
  const massDeployResultIsDryRun = !!(massDeployResult?.dryRun ?? massDeployResult?.dry_run);
  const massDeployDone = !!massDeployResult && !massDeployResultIsDryRun;
  const canDeployProvider = !!activeSourceCredential && !!activeTargetCredential;

  const handleRunBootstrapProvider = async () => {
    if (!providerProjectId) {
      setProviderBootstrapError("Select an active provider (source) credential first.");
      return;
    }
    setProviderBootstrapError("");
    setProviderBootstrapResult(null);
    setProviderBootstrapLoading(true);
    try {
      const result = await bootstrapProvider({
        region: providerHealth?.triggerservice?.region || "us-central1",
        branch: "main",
      });
      setProviderBootstrapResult(result);
    } catch (err) {
      setProviderBootstrapError(err.detail || err.message || "Failed to start provider bootstrap.");
    } finally {
      setProviderBootstrapLoading(false);
    }
  };

  const handleRunMassDeploy = async () => {
    if (!canDeployProvider) {
      setMassDeployError("Activate provider (source) and target credentials first.");
      return;
    }
    if (providerBlocked) {
      setMassDeployError("Provider health is blocking deploy; fix TriggerService/credentials first.");
      return;
    }
    setMassDeployError("");
    setMassDeployResult(null);
    setMassDeployLoading(true);
    try {
      const response = await runMassDeploy({
        dryRun: massDeployDryRun,
        includeSchedulers: massDeployIncludeSchedulers,
      });
      setMassDeployResult(response);
    } catch (err) {
      setMassDeployError(err.detail || err.message || "Failed to start mass deploy.");
    } finally {
      setMassDeployLoading(false);
    }
  };

  return (
    <PageLayout
      title="Setup Wizard"
      subtitle="Guided setup for provider projects and tenant onboarding. Reuses TriggerService, credential store, and the tenant provisioning flow."
    >
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <SectionCard
            title="Service Provider Setup"
            subtitle="Run once per provider project to bootstrap TriggerService, core infra, and deploy the core agents."
          >
            <Stack spacing={2}>
              <Stepper activeStep={providerStep} alternativeLabel>
                <Step>
                  <StepLabel>Credentials & TriggerService</StepLabel>
                </Step>
                <Step>
                  <StepLabel>Bootstrap provider project</StepLabel>
                </Step>
                <Step>
                  <StepLabel>Deploy core agents</StepLabel>
                </Step>
                <Step>
                  <StepLabel>Review provider health</StepLabel>
                </Step>
              </Stepper>

              {providerStep === 0 && (
                <Box>
                  <Typography variant="subtitle1" gutterBottom>
                    Step 1: Connect provider credentials and TriggerService
                  </Typography>
                  {providerHealthLoading ? (
                    <Alert severity="info">Checking provider health…</Alert>
                  ) : providerHealthError ? (
                    <Alert severity="error">{providerHealthError}</Alert>
                  ) : (
                    <>
                      <Alert
                        severity={
                          providerBlocked ? "error" : providerHealthy ? "success" : "warning"
                        }
                        sx={{ mb: 2 }}
                      >
                        {providerBlocked
                          ? "Provider setup is blocking deployments. Fix TriggerService and credentials."
                          : providerHealthy
                          ? "Provider looks healthy. TriggerService reachable and credentials detected."
                          : "Provider has warnings. Review TriggerService and credentials before proceeding."}
                      </Alert>
                      <Typography variant="body2" color="text.secondary">
                        Active provider credential:{" "}
                        {activeSourceCredential?.label || "none selected (go to Credentials page)."}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Active target credential:{" "}
                        {activeTargetCredential?.label || "none selected (go to Credentials page)."}
                      </Typography>
                    </>
                  )}
                  <Stack direction="row" spacing={1} sx={{ mt: 2 }} justifyContent="space-between">
                    <Button
                      variant="outlined"
                      startIcon={<RefreshIcon />}
                      onClick={refreshProviderHealth}
                      disabled={providerHealthLoading}
                    >
                      Refresh status
                    </Button>
                    <Button
                      variant="contained"
                      onClick={() => setProviderStep(1)}
                      disabled={!providerCredentialsReady}
                    >
                      Continue
                    </Button>
                  </Stack>
                  {!providerCredentialsReady && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                      Tip: Activate and prime provider/target credentials on the Credentials and Permissions pages, then refresh.
                    </Typography>
                  )}
                </Box>
              )}

              {providerStep === 1 && (
                <Box>
                  <Typography variant="subtitle1" gutterBottom>
                    Step 2: Bootstrap provider project via Cloud Build
                  </Typography>
                  <Typography variant="body2" color="text.secondary" paragraph>
                    This runs <code>make bootstrap-provider</code> in the thunderdeploy repo using the active provider credential.
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Typography variant="body2" gutterBottom>
                      Provider project: <strong>{providerProjectId || "unknown"}</strong>
                    </Typography>
                    <Button
                      variant="contained"
                      startIcon={
                        providerBootstrapLoading ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />
                      }
                      disabled={providerBootstrapLoading || !providerProjectId}
                      onClick={handleRunBootstrapProvider}
                    >
                      {providerBootstrapLoading ? "Starting bootstrap…" : "Run bootstrap"}
                    </Button>
                    {providerBootstrapError ? (
                      <Alert severity="error" sx={{ mt: 2 }}>
                        {providerBootstrapError}
                      </Alert>
                    ) : null}
                    {providerBootstrapResult ? (
                      <Alert severity="info" sx={{ mt: 2 }}>
                        Bootstrap build {providerBootstrapResult.buildId || "submitted"} ({providerBootstrapResult.status || "QUEUED"}).{" "}
                        {providerBootstrapResult.logUrl ? (
                          <Link href={providerBootstrapResult.logUrl} target="_blank" rel="noopener noreferrer">
                            View Cloud Build logs
                          </Link>
                        ) : null}
                      </Alert>
                    ) : null}
                  </Paper>
                  <Stack direction="row" spacing={1} justifyContent="space-between">
                    <Button variant="outlined" onClick={() => setProviderStep(0)}>
                      Back
                    </Button>
                    <Button
                      variant="contained"
                      onClick={() => setProviderStep(2)}
                      disabled={!providerBootstrapDone}
                    >
                      Continue
                    </Button>
                  </Stack>
                </Box>
              )}

              {providerStep === 2 && (
                <Box>
                  <Typography variant="subtitle1" gutterBottom>
                    Step 3: Deploy core agents (10-agent stack)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" paragraph>
                    Use the same mass deploy flow as the Deploy page. Start with a dry-run, then run a real deploy (optionally skipping schedulers) once you are satisfied.
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Stack spacing={1.5}>
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant={massDeployDryRun ? "contained" : "outlined"}
                          size="small"
                          onClick={() => setMassDeployDryRun(true)}
                        >
                          Preview (dry-run)
                        </Button>
                        <Button
                          variant={!massDeployDryRun ? "contained" : "outlined"}
                          size="small"
                          onClick={() => setMassDeployDryRun(false)}
                        >
                          Run deploy
                        </Button>
                      </Stack>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={massDeployIncludeSchedulers}
                            onChange={(e) => setMassDeployIncludeSchedulers(e.target.checked)}
                          />
                        }
                        label="Include scheduling agents (slower builds)"
                      />
                      <Button
                        variant="contained"
                        startIcon={massDeployLoading ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                        disabled={massDeployLoading || !canDeployProvider}
                        onClick={handleRunMassDeploy}
                      >
                        {massDeployLoading
                          ? massDeployDryRun
                            ? "Starting dry-run…"
                            : "Starting deploy…"
                          : massDeployDryRun
                          ? "Preview (dry-run)"
                          : "Run deploy"}
                      </Button>
                      {massDeployError ? <Alert severity="error">{massDeployError}</Alert> : null}
                      {massDeployResult ? (
                        <Alert severity="info">
                          {(massDeployResult.dryRun ?? massDeployResult.dry_run) ? "Dry-run" : "Deploy"} build{" "}
                          {massDeployResult.buildId || "submitted"} ({massDeployResult.status || "QUEUED"}).{" "}
                          {massDeployResult.logUrl ? (
                            <Link href={massDeployResult.logUrl} target="_blank" rel="noopener noreferrer">
                              View Cloud Build logs
                            </Link>
                          ) : null}
                        </Alert>
                      ) : null}
                    </Stack>
                  </Paper>
                  <Stack direction="row" spacing={1} justifyContent="space-between">
                    <Button variant="outlined" onClick={() => setProviderStep(1)}>
                      Back
                    </Button>
                    <Button
                      variant="contained"
                      onClick={() => setProviderStep(3)}
                      disabled={!massDeployDone}
                    >
                      Continue
                    </Button>
                  </Stack>
                </Box>
              )}

              {providerStep === 3 && (
                <Box>
                  <Typography variant="subtitle1" gutterBottom>
                    Step 4: Review provider health and finish
                  </Typography>
                  {providerHealthLoading ? (
                    <Alert severity="info">Refreshing provider health…</Alert>
                  ) : providerHealthError ? (
                    <Alert severity="warning">{providerHealthError}</Alert>
                  ) : (
                    <Alert
                      severity={providerBlocked ? "error" : providerHealthy ? "success" : "warning"}
                      sx={{ mb: 2 }}
                    >
                      {providerBlocked
                        ? "Provider still has blocking issues. Check TriggerService and credentials in Health/Deploy pages."
                        : providerHealthy
                        ? "Provider looks healthy. You can start onboarding tenants."
                        : "Provider has warnings; check the Health and Deploy dashboards for details."}
                    </Alert>
                  )}
                  <Typography variant="body2" color="text.secondary" paragraph>
                    Use the <Link href="/health">Health</Link> and <Link href="/deploy">Deploy</Link> pages for detailed status and history.
                  </Typography>
                  <Stack direction="row" spacing={1} justifyContent="space-between">
                    <Button variant="outlined" onClick={() => setProviderStep(2)}>
                      Back
                    </Button>
                    <Button variant="contained" onClick={refreshProviderHealth}>
                      Refresh health
                    </Button>
                  </Stack>
                </Box>
              )}
            </Stack>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <SectionCard
            title="Tenant Onboarding Wizard"
            subtitle="Once the provider is ready, onboard customer projects and deploy the tenant stack."
          >
            <Stack spacing={2}>
              <Stepper activeStep={tenantStep} alternativeLabel>
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

              {tenantStep === 0 && (
                <Box>
                  <Typography variant="subtitle1" gutterBottom>
                    Step 1: Verify provider and credentials
                  </Typography>
                  <Typography variant="body2" color="text.secondary" paragraph>
                    Before provisioning tenants, ensure the provider project is bootstrapped, core agents are deployed, and credentials are primed.
                  </Typography>
                  {providerHealthLoading ? (
                    <Alert severity="info">Checking provider setup…</Alert>
                  ) : providerHealthError ? (
                    <Alert severity="warning">{providerHealthError}</Alert>
                  ) : (
                    <Alert severity={providerBlocked ? "error" : providerHealthy ? "success" : "warning"}>
                      {providerBlocked
                        ? "Provider setup is blocking tenant provisioning. Fix issues on the Deploy/Health pages."
                        : providerHealthy
                        ? "Provider looks healthy. You can proceed to tenant provisioning."
                        : "Provider has warnings. You can proceed, but monitor deployments closely."}
                    </Alert>
                  )}
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                    Active provider (source) credential: {activeSourceCredential?.label || "none – configure on Credentials page."}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Active target credential (tenants): {activeTargetCredential?.label || "none – configure on Credentials page."}
                  </Typography>
                  <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 2 }}>
                    <Button variant="outlined" onClick={refreshProviderHealth}>
                      Refresh
                    </Button>
                    <Button
                      variant="contained"
                      onClick={() => setTenantStep(1)}
                      disabled={!providerHealthy || !activeSourceCredential || !activeTargetCredential}
                    >
                      Continue
                    </Button>
                  </Stack>
                </Box>
              )}

              {tenantStep === 1 && (
                <Box>
                  <Typography variant="subtitle1" gutterBottom>
                    Step 2: Configure and provision tenant stack
                  </Typography>
                  <Typography variant="body2" color="text.secondary" paragraph>
                    Fill out tenant project details, pick the shared Cloud SQL instance and a tenant database, and choose the configuration source. The form submits a full 10-agent deployment job via TriggerService.
                  </Typography>
                  <TenantProvisioningForm
                    serviceAccount={activeSourceCredential?.credential || null}
                    customerServiceAccount={activeTargetCredential?.credential || null}
                    providerHealth={providerHealth}
                  />
                  <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 2 }}>
                    <Button variant="outlined" onClick={() => setTenantStep(0)}>
                      Back
                    </Button>
                    <Button variant="contained" onClick={() => setTenantStep(2)}>
                      Next: Monitor
                    </Button>
                  </Stack>
                </Box>
              )}

              {tenantStep === 2 && (
                <Box>
                  <Typography variant="subtitle1" gutterBottom>
                    Step 3: Monitor deployments & operate
                  </Typography>
                  <Typography variant="body2" color="text.secondary" paragraph>
                    Use the Deployment Dashboard and Tenants views to track deployments, check job history, and manage service revisions. You can rerun this wizard to onboard additional tenants.
                  </Typography>
                  <Stack spacing={1.5}>
                    <Button variant="outlined" href="/">
                      Open Deployment Dashboard
                    </Button>
                    <Button variant="outlined" href="/tenants">
                      Open Tenants & Deployments view
                    </Button>
                    <Button variant="outlined" href="/deploy">
                      Open Deploy (provider view)
                    </Button>
                  </Stack>
                  <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
                    <Button variant="outlined" onClick={() => setTenantStep(1)}>
                      Back
                    </Button>
                    <Button variant="contained" onClick={() => setTenantStep(0)}>
                      Start another tenant
                    </Button>
                  </Stack>
                </Box>
              )}
            </Stack>
          </SectionCard>
        </Grid>
      </Grid>
    </PageLayout>
  );
}
