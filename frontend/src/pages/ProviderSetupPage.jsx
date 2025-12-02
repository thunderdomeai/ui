import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import PageLayout from "../components/PageLayout.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { useCredentialStore } from "../hooks/credentials/useCredentialStores.js";
import { fetchProviderHealth, bootstrapProvider, runMassDeploy } from "../utils/api.js";

function formatError(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    if (err.detail) return formatError(err.detail);
    if (err.message) return err.message;
    try {
      return JSON.stringify(err);
    } catch (_e) {
      return String(err);
    }
  }
  return String(err);
}

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

export default function ProviderSetupPage() {
  const sourceStore = useCredentialStore("source");
  const targetStore = useCredentialStore("target");

  const [step, setStep] = useState(0);

  const [providerHealth, setProviderHealth] = useState(null);
  const [providerHealthLoading, setProviderHealthLoading] = useState(false);
  const [providerHealthError, setProviderHealthError] = useState("");

  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapResult, setBootstrapResult] = useState(null);
  const [bootstrapError, setBootstrapError] = useState("");

  const [massDeployLoading, setMassDeployLoading] = useState(false);
  const [massDeployResult, setMassDeployResult] = useState(null);
  const [massDeployError, setMassDeployError] = useState("");
  const [massDeployDryRun, setMassDeployDryRun] = useState(true);
  const [massDeployIncludeSchedulers, setMassDeployIncludeSchedulers] = useState(false);

  const activeSource = useMemo(
    () => sourceStore.entries.find((entry) => entry.id === sourceStore.selectedId) ?? null,
    [sourceStore.entries, sourceStore.selectedId],
  );
  const activeTarget = useMemo(
    () => targetStore.entries.find((entry) => entry.id === targetStore.selectedId) ?? null,
    [targetStore.entries, targetStore.selectedId],
  );

  const providerProjectId = useMemo(
    () =>
      activeSource?.projectId ||
      activeSource?.credential?.project_id ||
      providerHealth?.source_credential?.projectId ||
      "",
    [activeSource, providerHealth],
  );

  const refreshProviderHealth = useCallback(async () => {
    setProviderHealthLoading(true);
    setProviderHealthError("");
    try {
      const data = await fetchProviderHealth();
      setProviderHealth(data);
    } catch (err) {
      setProviderHealthError(formatError(err) || "Failed to load provider health.");
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

  const triggerservice = providerHealth?.triggerservice || {};
  const providerChecklist = {
    sourceSelected: !!activeSource,
    targetSelected: !!activeTarget,
    triggerserviceConfigured: !!triggerservice.configured,
    triggerserviceReachable: !!triggerservice.reachable,
  };

  const canAdvanceFromStep0 =
    providerChecklist.sourceSelected &&
    providerChecklist.targetSelected &&
    providerChecklist.triggerserviceConfigured &&
    !providerBlocked;

  const massDeployResultIsDryRun = !!(massDeployResult?.dryRun ?? massDeployResult?.dry_run);
  const previewDone = !!massDeployResult && massDeployResultIsDryRun;
  const deployDone = !!massDeployResult && !massDeployResultIsDryRun;

  const handleRunBootstrap = async () => {
    if (!providerProjectId) {
      setBootstrapError("Select an active provider (source) credential first.");
      return;
    }
    setBootstrapError("");
    setBootstrapResult(null);
    setBootstrapLoading(true);
    try {
      const res = await bootstrapProvider({
        region: providerHealth?.triggerservice?.region || "us-central1",
        branch: "main",
      });
      setBootstrapResult(res);
    } catch (err) {
      setBootstrapError(formatError(err) || "Failed to start provider bootstrap.");
    } finally {
      setBootstrapLoading(false);
    }
  };

  const handleRunMassDeploy = async () => {
    if (providerBlocked) {
      setMassDeployError("Provider health is blocking deploy; fix TriggerService/credentials first.");
      return;
    }
    if (!activeSource || !activeTarget) {
      setMassDeployError("Activate provider (source) and target credentials first.");
      return;
    }
    setMassDeployError("");
    setMassDeployResult(null);
    setMassDeployLoading(true);
    try {
      const res = await runMassDeploy({
        dryRun: massDeployDryRun,
        includeSchedulers: massDeployIncludeSchedulers,
      });
      setMassDeployResult(res);
    } catch (err) {
      setMassDeployError(formatError(err) || "Failed to start mass deploy.");
    } finally {
      setMassDeployLoading(false);
    }
  };

  return (
    <PageLayout
      title="Service Provider Setup"
      subtitle="Run once per provider project to bootstrap TriggerService, prepare core infra, and deploy the core agent stack."
    >
      <SectionCard
        title="Provider Setup Wizard"
        subtitle="Guided steps for provider projects using existing credential store and TriggerService workflows."
      >
        <Stack spacing={2}>
          <Stepper activeStep={step} alternativeLabel>
            <Step>
              <StepLabel>Priming & credentials</StepLabel>
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

          {step === 0 && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Step 1: Priming & credentials
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                In this step we make sure the provider project is ready to be primed:
                <br />
                • The provider (source) credential is selected and verified.
                <br />
                • The target (tenant) credential is selected.
                <br />
                • TriggerService is configured and reachable.
                <br />
                Once these are green, the next step will create or verify:
                <br />
                • Logs bucket (e.g. <code>{`{project}`}-thunder-deploy-logs</code>) for Cloud Build and deploy logs.
                <br />
                • Dashboard storage bucket (if configured) for job history.
                <br />
                • Core Cloud SQL instance and DB used by ThunderdomeCore.
              </Typography>

              {providerHealthLoading ? (
                <Alert severity="info">Checking provider status…</Alert>
              ) : providerHealthError ? (
                <Alert severity="warning">{providerHealthError}</Alert>
              ) : providerBlocked ? (
                <Alert severity="error">
                  Provider setup is blocking deployments. Fix TriggerService configuration or credentials before continuing.
                </Alert>
              ) : providerHealthy ? (
                <Alert severity="success">Provider looks healthy. You can proceed to bootstrap.</Alert>
              ) : (
                <Alert severity="warning">
                  Provider has warnings. You can proceed, but review Deploy/Health pages for details.
                </Alert>
              )}

              <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Priming prerequisites
                </Typography>
                <ChecklistItem
                  label={`Provider credential selected (${activeSource?.label || "none"})`}
                  done={providerChecklist.sourceSelected}
                />
                <ChecklistItem
                  label={`Target credential selected (${activeTarget?.label || "none"})`}
                  done={providerChecklist.targetSelected}
                />
                <ChecklistItem
                  label="TriggerService configured and bound"
                  done={providerChecklist.triggerserviceConfigured}
                />
                <ChecklistItem
                  label="TriggerService reachable from Unified UI"
                  done={providerChecklist.triggerserviceReachable}
                />
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
                <Button variant="contained" onClick={() => setStep(1)} disabled={!canAdvanceFromStep0}>
                  Continue
                </Button>
              </Stack>
              {!canAdvanceFromStep0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                  Tip: Use the Credentials, Permissions, and Deploy pages to prime credentials, then refresh.
                </Typography>
              )}
            </Box>
          )}

          {step === 1 && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Step 2: Bootstrap provider project (priming + core services)
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                This step runs <code>make bootstrap-provider</code> in the thunderdeploy repo using the active provider credential. It:
                <br />
                • Ensures the logs bucket (<code>{`gs://${providerProjectId || "project"}-thunder-deploy-logs`}</code>) exists for Cloud Build and deploy logs.
                <br />
                • Ensures the job dashboard bucket is created (if enabled) so job history is persisted.
                <br />
                • Prepares or verifies the core Cloud SQL instance and provider DB used by ThunderdomeCore.
                <br />
                • Deploys or updates TriggerService and any other provider-side control-plane services.
              </Typography>

              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Priming checklist (provider project {providerProjectId || "unknown"})
                </Typography>
                <ChecklistItem
                  label="Logs bucket created/verified (e.g. <project>-thunder-deploy-logs)"
                  done={!!bootstrapResult}
                />
                <ChecklistItem label="Dashboard bucket created/verified (if configured)" done={!!bootstrapResult} />
                <ChecklistItem label="Core Cloud SQL instance and DB prepared (thunderdome / thunderdomecore_ynv_data)" done={!!bootstrapResult} />
                <ChecklistItem label="TriggerService and core control-plane services deployed/updated" done={!!bootstrapResult} />
              </Paper>

              <Button
                variant="contained"
                startIcon={bootstrapLoading ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                disabled={bootstrapLoading || !providerProjectId}
                onClick={handleRunBootstrap}
              >
                {bootstrapLoading ? "Starting bootstrap…" : "Run bootstrap"}
              </Button>

              {bootstrapError ? (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {bootstrapError}
                </Alert>
              ) : null}
              {bootstrapResult ? (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Bootstrap build {bootstrapResult.buildId || "submitted"} ({bootstrapResult.status || "QUEUED"}).{" "}
                  {bootstrapResult.logUrl ? (
                    <Link href={bootstrapResult.logUrl} target="_blank" rel="noopener noreferrer">
                      View Cloud Build logs
                    </Link>
                  ) : null}
                </Alert>
              ) : null}

              <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 2 }}>
                <Button variant="outlined" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button variant="contained" onClick={() => setStep(2)} disabled={!bootstrapResult}>
                  Continue
                </Button>
              </Stack>
            </Box>
          )}

          {step === 2 && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Step 3: Deploy core agents (10-agent stack)
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                With buckets and databases primed, this step uses the 10-agent deployment script to build and deploy the provider's core agents (ThunderdomeCore, MCP registry, ThunderMCPSQL, broker, WhatsApp handler, etc.).
                Start with a dry-run to confirm the graph and then run a real deploy (optionally skipping the slow schedulers).
                This wraps <code>deploy_agents_ordered.py</code> via Cloud Build.
              </Typography>

              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Planned operations
                </Typography>
                <ChecklistItem label="Dry-run submitted" done={previewDone || deployDone} />
                <ChecklistItem
                  label="Full deploy submitted (core agents)"
                  done={deployDone}
                />
              </Paper>

              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
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
                <Button
                  variant={massDeployIncludeSchedulers ? "contained" : "outlined"}
                  size="small"
                  onClick={() => setMassDeployIncludeSchedulers((prev) => !prev)}
                >
                  {massDeployIncludeSchedulers ? "Including schedulers" : "Skip schedulers"}
                </Button>
              </Stack>

              <Button
                variant="contained"
                startIcon={massDeployLoading ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                disabled={massDeployLoading}
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

              {massDeployError ? (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {massDeployError}
                </Alert>
              ) : null}
              {massDeployResult ? (
                <Alert severity="info" sx={{ mt: 2 }}>
                  {massDeployResult.dryRun || massDeployResult.dry_run ? "Dry-run" : "Deploy"} build{" "}
                  {massDeployResult.buildId || massDeployResult.id || "submitted"} ({massDeployResult.status || "QUEUED"}).{" "}
                  {massDeployResult.logUrl ? (
                    <Link href={massDeployResult.logUrl} target="_blank" rel="noopener noreferrer">
                      View Cloud Build logs
                    </Link>
                  ) : null}
                </Alert>
              ) : null}

              <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 2 }}>
                <Button variant="outlined" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button variant="contained" onClick={() => setStep(3)} disabled={!deployDone}>
                  Continue
                </Button>
              </Stack>
            </Box>
          )}

          {step === 3 && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Step 4: Review provider health and endpoints
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                At this point the provider project should have:
                <br />
                • TriggerService deployed and reachable.
                <br />
                • Core DB ready and used by ThunderdomeCore.
                <br />
                • Core agents deployed (registry, broker, WhatsApp handler, etc.).
                <br />
                Use the Health and Tenants views to inspect endpoints:
                <br />
                • Health dashboard shows service readiness per tenant.
                <br />
                • Tenants & Deployments shows per-service URLs and status via TriggerService.
              </Typography>

              {providerHealthLoading ? (
                <Alert severity="info">Refreshing provider health…</Alert>
              ) : providerHealthError ? (
                <Alert severity="warning">{providerHealthError}</Alert>
              ) : providerBlocked ? (
                <Alert severity="error">Provider still has blocking issues. Fix them before onboarding tenants.</Alert>
              ) : providerHealthy ? (
                <Alert severity="success">Provider looks healthy. You can start tenant onboarding.</Alert>
              ) : (
                <Alert severity="warning">Provider has warnings; monitor deployments closely.</Alert>
              )}

              <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Status checklist
                </Typography>
                <ChecklistItem label="TriggerService configured" done={!!triggerservice.configured} />
                <ChecklistItem label="TriggerService reachable" done={!!triggerservice.reachable} />
                <ChecklistItem label="Source credential present" done={!!activeSource} />
                <ChecklistItem label="Target credential present" done={!!activeTarget} />
              </Paper>

              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }} paragraph>
                Next steps: open the <Link href="/deploy">Deploy</Link> and <Link href="/health">Health</Link> pages to monitor services,
                or proceed to <Link href="/tenant-setup">Tenant Setup</Link> to onboard customers.
              </Typography>

              <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 2 }}>
                <Button variant="outlined" onClick={() => setStep(2)}>
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
    </PageLayout>
  );
}
