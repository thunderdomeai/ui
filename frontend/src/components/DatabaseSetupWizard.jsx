import { useState, useEffect, useCallback, useMemo } from "react";
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Divider,
    FormControlLabel,
    IconButton,
    LinearProgress,
    Paper,
    Radio,
    RadioGroup,
    Stack,
    Step,
    StepLabel,
    Stepper,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import WarningIcon from "@mui/icons-material/Warning";
import RefreshIcon from "@mui/icons-material/Refresh";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

import {
    sqlPreflightCheck,
    sqlInstancesList,
    sqlInstancesCreate,
    sqlOperationStatus,
    sqlDatabasesCreate,
    sqlUsersCreate,
    validateSqlDatabase,
} from "../utils/api.js";

const STEPS = ["Preflight Check", "Instance Setup", "Database & User", "Review"];

const TIERS = [
    { value: "db-f1-micro", label: "db-f1-micro (shared, 0.6 GB)" },
    { value: "db-g1-small", label: "db-g1-small (shared, 1.7 GB)" },
    { value: "db-custom-1-3840", label: "db-custom-1-3840 (1 vCPU, 3.75 GB)" },
    { value: "db-custom-2-7680", label: "db-custom-2-7680 (2 vCPU, 7.5 GB)" },
];

const REGIONS = [
    { value: "us-central1", label: "us-central1 (Iowa)" },
    { value: "us-east1", label: "us-east1 (South Carolina)" },
    { value: "us-west1", label: "us-west1 (Oregon)" },
    { value: "europe-west1", label: "europe-west1 (Belgium)" },
    { value: "asia-east1", label: "asia-east1 (Taiwan)" },
];

function PermissionItem({ label, ok, loading }) {
    return (
        <Stack direction="row" alignItems="center" spacing={1}>
            {loading ? (
                <CircularProgress size={16} />
            ) : ok ? (
                <CheckCircleIcon color="success" fontSize="small" />
            ) : (
                <ErrorIcon color="error" fontSize="small" />
            )}
            <Typography variant="body2">{label}</Typography>
        </Stack>
    );
}

function generatePassword(length = 24) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export default function DatabaseSetupWizard({ scope = "source", onComplete, onCancel }) {
    const [activeStep, setActiveStep] = useState(0);

    // Preflight state
    const [preflightLoading, setPreflightLoading] = useState(false);
    const [preflightResult, setPreflightResult] = useState(null);
    const [preflightError, setPreflightError] = useState("");

    // Instance state
    const [instanceMode, setInstanceMode] = useState("existing"); // "existing" or "new"
    const [existingInstances, setExistingInstances] = useState([]);
    const [selectedInstance, setSelectedInstance] = useState("");
    const [newInstanceName, setNewInstanceName] = useState("thunderdome");
    const [newInstanceRegion, setNewInstanceRegion] = useState("us-central1");
    const [newInstanceTier, setNewInstanceTier] = useState("db-f1-micro");
    const [instanceLoading, setInstanceLoading] = useState(false);
    const [instanceError, setInstanceError] = useState("");
    const [operationId, setOperationId] = useState("");
    const [operationStatus, setOperationStatus] = useState(null);

    // Database & User state
    const [databaseMode, setDatabaseMode] = useState("new"); // "existing" or "new"
    const [existingDatabases, setExistingDatabases] = useState([]);
    const [databaseName, setDatabaseName] = useState("thunderdomecore_ynv_data");
    const [username, setUsername] = useState("thunderadmin");
    const [password, setPassword] = useState(() => generatePassword());
    const [showPassword, setShowPassword] = useState(false);
    const [dbLoading, setDbLoading] = useState(false);
    const [dbError, setDbError] = useState("");
    const [dbResult, setDbResult] = useState(null);
    const [userResult, setUserResult] = useState(null);

    // Computed values
    const currentInstance = useMemo(() => {
        if (instanceMode === "existing") return selectedInstance;
        return newInstanceName;
    }, [instanceMode, selectedInstance, newInstanceName]);

    const connectionName = useMemo(() => {
        if (!preflightResult?.project_id || !currentInstance) return "";
        const region = instanceMode === "existing"
            ? existingInstances.find(i => i.name === selectedInstance)?.region || "us-central1"
            : newInstanceRegion;
        return `${preflightResult.project_id}:${region}:${currentInstance}`;
    }, [preflightResult, currentInstance, instanceMode, selectedInstance, existingInstances, newInstanceRegion]);

    // Run preflight check
    const runPreflightCheck = useCallback(async () => {
        setPreflightLoading(true);
        setPreflightError("");
        try {
            const data = await sqlPreflightCheck(scope);
            setPreflightResult(data);
            if (data.existing_instances) {
                setExistingInstances(data.existing_instances);
                if (data.existing_instances.length > 0 && !selectedInstance) {
                    setSelectedInstance(data.existing_instances[0].name);
                }
            }
            if (!data.ok) {
                setPreflightError(data.error || "Preflight check failed.");
            }
        } catch (err) {
            setPreflightError(err.message || "Failed to run preflight check.");
        } finally {
            setPreflightLoading(false);
        }
    }, [scope, selectedInstance]);

    // Auto-run preflight on mount
    useEffect(() => {
        runPreflightCheck();
    }, [runPreflightCheck]);

    // Poll operation status
    useEffect(() => {
        if (!operationId || operationStatus?.status === "DONE" || operationStatus?.status === "ERROR") {
            return;
        }
        const interval = setInterval(async () => {
            try {
                const data = await sqlOperationStatus(operationId);
                setOperationStatus(data);
                if (data.status === "DONE" || data.status === "ERROR") {
                    clearInterval(interval);
                    if (data.status === "DONE") {
                        // Refresh instance list
                        const listData = await sqlInstancesList(scope);
                        setExistingInstances(listData.instances || []);
                        setSelectedInstance(newInstanceName);
                        setInstanceMode("existing");
                    }
                }
            } catch (err) {
                console.error("Failed to poll operation:", err);
            }
        }, 5000);
        return () => clearInterval(interval);
    }, [operationId, operationStatus, scope, newInstanceName]);

    // Create new instance
    const handleCreateInstance = async () => {
        setInstanceLoading(true);
        setInstanceError("");
        try {
            const data = await sqlInstancesCreate({
                name: newInstanceName,
                region: newInstanceRegion,
                tier: newInstanceTier,
                scope,
            });
            setOperationId(data.operation_id);
            setOperationStatus({ status: "RUNNING", progress_percent: 5 });
        } catch (err) {
            setInstanceError(err.message || "Failed to create instance.");
        } finally {
            setInstanceLoading(false);
        }
    };

    // Validate existing database
    const validateDatabase = async () => {
        try {
            const data = await validateSqlDatabase(currentInstance, databaseName, scope);
            if (data.status === "exists") {
                setExistingDatabases(prev => [...prev, databaseName]);
            }
            return data;
        } catch (err) {
            return null;
        }
    };

    // Create database and user
    const handleCreateDatabaseAndUser = async () => {
        setDbLoading(true);
        setDbError("");
        setDbResult(null);
        setUserResult(null);

        try {
            // Create database
            const dbData = await sqlDatabasesCreate({
                instance: currentInstance,
                database: databaseName,
                scope,
            });
            setDbResult(dbData);

            // Create user
            const userData = await sqlUsersCreate({
                instance: currentInstance,
                username,
                password,
                scope,
            });
            setUserResult(userData);
        } catch (err) {
            setDbError(err.message || "Failed to create database or user.");
        } finally {
            setDbLoading(false);
        }
    };

    // Step navigation
    const canProceed = (step) => {
        switch (step) {
            case 0: // Preflight
                return preflightResult?.ok === true;
            case 1: // Instance
                if (instanceMode === "new") {
                    return operationStatus?.status === "DONE";
                }
                return !!selectedInstance;
            case 2: // Database & User
                return dbResult && userResult;
            default:
                return true;
        }
    };

    const handleNext = async () => {
        if (activeStep === 1 && instanceMode === "existing") {
            // Validate database exists when moving to step 2
            await validateDatabase();
        }
        if (activeStep < STEPS.length - 1) {
            setActiveStep(prev => prev + 1);
        } else {
            // Complete
            onComplete?.({
                instance: currentInstance,
                connectionName,
                database: databaseName,
                username,
                password,
                projectId: preflightResult?.project_id,
            });
        }
    };

    const handleBack = () => {
        setActiveStep(prev => prev - 1);
    };

    return (
        <Box>
            <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
                {STEPS.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            {/* Step 0: Preflight Check */}
            {activeStep === 0 && (
                <Paper variant="outlined" sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Preflight Permission Check
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        Verifying Cloud SQL Admin API access and permissions for database operations.
                    </Typography>

                    {preflightLoading ? (
                        <Stack direction="row" alignItems="center" spacing={2} sx={{ my: 2 }}>
                            <CircularProgress size={24} />
                            <Typography>Checking permissions...</Typography>
                        </Stack>
                    ) : preflightError ? (
                        <Alert severity="error" sx={{ my: 2 }}>
                            {preflightError}
                        </Alert>
                    ) : preflightResult ? (
                        <>
                            <Stack spacing={1} sx={{ my: 2 }}>
                                <PermissionItem label="Cloud SQL Admin API enabled" ok={preflightResult.api_enabled} />
                                <PermissionItem label="List instances" ok={preflightResult.permissions?.instances_list} />
                                <PermissionItem label="Create instances" ok={preflightResult.permissions?.instances_create} />
                                <PermissionItem label="Manage databases" ok={preflightResult.permissions?.databases_create} />
                                <PermissionItem label="Manage users" ok={preflightResult.permissions?.users_create} />
                            </Stack>

                            <Divider sx={{ my: 2 }} />

                            <Stack direction="row" spacing={2} alignItems="center">
                                <Chip
                                    label={`Quota: ${preflightResult.quota?.instances_available || 0} instances available`}
                                    color={preflightResult.quota?.instances_available > 0 ? "success" : "warning"}
                                    size="small"
                                />
                                <Chip
                                    label={`Project: ${preflightResult.project_id}`}
                                    variant="outlined"
                                    size="small"
                                />
                            </Stack>

                            {preflightResult.existing_instances?.length > 0 && (
                                <Box sx={{ mt: 2 }}>
                                    <Typography variant="subtitle2" gutterBottom>
                                        Existing Instances ({preflightResult.existing_instances.length})
                                    </Typography>
                                    {preflightResult.existing_instances.map((inst) => (
                                        <Chip
                                            key={inst.name}
                                            label={`${inst.name} (${inst.region})`}
                                            size="small"
                                            sx={{ mr: 1, mb: 1 }}
                                            color={inst.status === "RUNNABLE" ? "success" : "default"}
                                        />
                                    ))}
                                </Box>
                            )}
                        </>
                    ) : null}

                    <Stack direction="row" justifyContent="space-between" sx={{ mt: 3 }}>
                        <Button onClick={onCancel} variant="outlined">
                            Cancel
                        </Button>
                        <Stack direction="row" spacing={1}>
                            <Button
                                onClick={runPreflightCheck}
                                disabled={preflightLoading}
                                startIcon={<RefreshIcon />}
                            >
                                Re-check
                            </Button>
                            <Button
                                variant="contained"
                                onClick={handleNext}
                                disabled={!canProceed(0)}
                            >
                                Continue
                            </Button>
                        </Stack>
                    </Stack>
                </Paper>
            )}

            {/* Step 1: Instance Setup */}
            {activeStep === 1 && (
                <Paper variant="outlined" sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Cloud SQL Instance
                    </Typography>

                    <RadioGroup
                        value={instanceMode}
                        onChange={(e) => setInstanceMode(e.target.value)}
                        sx={{ mb: 2 }}
                    >
                        <FormControlLabel
                            value="existing"
                            control={<Radio />}
                            label="Use existing instance"
                            disabled={existingInstances.length === 0}
                        />
                        <FormControlLabel
                            value="new"
                            control={<Radio />}
                            label="Create new instance"
                        />
                    </RadioGroup>

                    {instanceMode === "existing" ? (
                        <Box>
                            {existingInstances.length === 0 ? (
                                <Alert severity="info">
                                    No existing instances found. Create a new instance below.
                                </Alert>
                            ) : (
                                <TextField
                                    select
                                    label="Select Instance"
                                    value={selectedInstance}
                                    onChange={(e) => setSelectedInstance(e.target.value)}
                                    fullWidth
                                    SelectProps={{ native: true }}
                                    sx={{ mb: 2 }}
                                >
                                    {existingInstances.map((inst) => (
                                        <option key={inst.name} value={inst.name}>
                                            {inst.name} — {inst.region} — {inst.status} — {inst.database_version}
                                        </option>
                                    ))}
                                </TextField>
                            )}
                        </Box>
                    ) : (
                        <Stack spacing={2}>
                            <TextField
                                label="Instance Name"
                                value={newInstanceName}
                                onChange={(e) => setNewInstanceName(e.target.value)}
                                helperText="Lowercase letters, numbers, and hyphens only"
                                disabled={operationId && operationStatus?.status === "RUNNING"}
                            />
                            <TextField
                                select
                                label="Region"
                                value={newInstanceRegion}
                                onChange={(e) => setNewInstanceRegion(e.target.value)}
                                SelectProps={{ native: true }}
                                disabled={operationId && operationStatus?.status === "RUNNING"}
                            >
                                {REGIONS.map((r) => (
                                    <option key={r.value} value={r.value}>
                                        {r.label}
                                    </option>
                                ))}
                            </TextField>
                            <TextField
                                select
                                label="Machine Type"
                                value={newInstanceTier}
                                onChange={(e) => setNewInstanceTier(e.target.value)}
                                SelectProps={{ native: true }}
                                disabled={operationId && operationStatus?.status === "RUNNING"}
                            >
                                {TIERS.map((t) => (
                                    <option key={t.value} value={t.value}>
                                        {t.label}
                                    </option>
                                ))}
                            </TextField>

                            {operationId && operationStatus ? (
                                <Box>
                                    <Alert
                                        severity={operationStatus.status === "DONE" ? "success" : operationStatus.status === "ERROR" ? "error" : "info"}
                                        sx={{ mb: 2 }}
                                    >
                                        {operationStatus.status === "DONE"
                                            ? `Instance ${newInstanceName} created successfully!`
                                            : operationStatus.status === "ERROR"
                                                ? operationStatus.error || "Instance creation failed."
                                                : `Creating instance... ${operationStatus.progress_percent || 0}%`}
                                    </Alert>
                                    {operationStatus.status === "RUNNING" && (
                                        <>
                                            <LinearProgress
                                                variant="determinate"
                                                value={operationStatus.progress_percent || 0}
                                                sx={{ mb: 1 }}
                                            />
                                            <Typography variant="caption" color="text.secondary">
                                                Elapsed: {Math.floor((operationStatus.elapsed_seconds || 0) / 60)}m {(operationStatus.elapsed_seconds || 0) % 60}s
                                                — Estimated: 15-20 minutes
                                            </Typography>
                                        </>
                                    )}
                                </Box>
                            ) : (
                                <>
                                    <Alert severity="warning" sx={{ mt: 1 }}>
                                        Instance creation takes 15-30 minutes. You can wait here or check back later.
                                    </Alert>
                                    <Button
                                        variant="contained"
                                        onClick={handleCreateInstance}
                                        disabled={instanceLoading || !newInstanceName}
                                        sx={{ alignSelf: "flex-start" }}
                                    >
                                        {instanceLoading ? "Starting..." : "Create Instance"}
                                    </Button>
                                </>
                            )}
                        </Stack>
                    )}

                    {instanceError && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            {instanceError}
                        </Alert>
                    )}

                    <Stack direction="row" justifyContent="space-between" sx={{ mt: 3 }}>
                        <Button onClick={handleBack} variant="outlined">
                            Back
                        </Button>
                        <Button
                            variant="contained"
                            onClick={handleNext}
                            disabled={!canProceed(1)}
                        >
                            Continue
                        </Button>
                    </Stack>
                </Paper>
            )}

            {/* Step 2: Database & User */}
            {activeStep === 2 && (
                <Paper variant="outlined" sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Database & User Setup
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        Instance: <strong>{currentInstance}</strong>
                    </Typography>

                    <Divider sx={{ my: 2 }} />

                    <Typography variant="subtitle2" gutterBottom>
                        Database
                    </Typography>
                    <TextField
                        label="Database Name"
                        value={databaseName}
                        onChange={(e) => setDatabaseName(e.target.value)}
                        fullWidth
                        sx={{ mb: 2 }}
                        disabled={dbLoading}
                    />

                    <Divider sx={{ my: 2 }} />

                    <Typography variant="subtitle2" gutterBottom>
                        Database User
                    </Typography>
                    <Stack spacing={2}>
                        <TextField
                            label="Username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            fullWidth
                            disabled={dbLoading}
                        />
                        <Stack direction="row" spacing={1} alignItems="flex-start">
                            <TextField
                                label="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                type={showPassword ? "text" : "password"}
                                fullWidth
                                disabled={dbLoading}
                                InputProps={{
                                    endAdornment: (
                                        <Stack direction="row">
                                            <IconButton onClick={() => setShowPassword(!showPassword)} size="small">
                                                {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                            </IconButton>
                                            <Tooltip title="Copy password">
                                                <IconButton
                                                    onClick={() => navigator.clipboard.writeText(password)}
                                                    size="small"
                                                >
                                                    <ContentCopyIcon />
                                                </IconButton>
                                            </Tooltip>
                                        </Stack>
                                    ),
                                }}
                            />
                            <Button
                                variant="outlined"
                                onClick={() => setPassword(generatePassword())}
                                disabled={dbLoading}
                                sx={{ whiteSpace: "nowrap" }}
                            >
                                Generate
                            </Button>
                        </Stack>
                        <Alert severity="info">
                            Save this password securely. It will be used for service deployments.
                        </Alert>
                    </Stack>

                    {dbError && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            {dbError}
                        </Alert>
                    )}

                    {dbResult && userResult && (
                        <Alert severity="success" sx={{ mt: 2 }}>
                            Database and user created successfully!
                        </Alert>
                    )}

                    <Stack direction="row" justifyContent="space-between" sx={{ mt: 3 }}>
                        <Button onClick={handleBack} variant="outlined">
                            Back
                        </Button>
                        <Stack direction="row" spacing={1}>
                            {!dbResult ? (
                                <Button
                                    variant="contained"
                                    onClick={handleCreateDatabaseAndUser}
                                    disabled={dbLoading || !databaseName || !username}
                                >
                                    {dbLoading ? "Creating..." : "Create Database & User"}
                                </Button>
                            ) : (
                                <Button
                                    variant="contained"
                                    onClick={handleNext}
                                    disabled={!canProceed(2)}
                                >
                                    Continue
                                </Button>
                            )}
                        </Stack>
                    </Stack>
                </Paper>
            )}

            {/* Step 3: Review */}
            {activeStep === 3 && (
                <Paper variant="outlined" sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Database Setup Complete
                    </Typography>

                    <Alert severity="success" sx={{ mb: 3 }}>
                        Your database is ready for use!
                    </Alert>

                    <Stack spacing={2}>
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                                Instance
                            </Typography>
                            <Typography variant="body1">{currentInstance}</Typography>
                        </Box>
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                                Connection Name
                            </Typography>
                            <Typography variant="body1" fontFamily="monospace">
                                {connectionName}
                            </Typography>
                        </Box>
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                                Socket Path
                            </Typography>
                            <Typography variant="body1" fontFamily="monospace">
                                /cloudsql/{connectionName}
                            </Typography>
                        </Box>
                        <Divider />
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                                Database
                            </Typography>
                            <Typography variant="body1">{databaseName}</Typography>
                        </Box>
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                                Username
                            </Typography>
                            <Typography variant="body1">{username}</Typography>
                        </Box>
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                                Password
                            </Typography>
                            <Stack direction="row" alignItems="center" spacing={1}>
                                <Typography variant="body1" fontFamily="monospace">
                                    {showPassword ? password : "••••••••••••••••"}
                                </Typography>
                                <IconButton onClick={() => setShowPassword(!showPassword)} size="small">
                                    {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                                </IconButton>
                                <IconButton onClick={() => navigator.clipboard.writeText(password)} size="small">
                                    <ContentCopyIcon fontSize="small" />
                                </IconButton>
                            </Stack>
                        </Box>
                    </Stack>

                    <Stack direction="row" justifyContent="space-between" sx={{ mt: 3 }}>
                        <Button onClick={handleBack} variant="outlined">
                            Back
                        </Button>
                        <Button variant="contained" onClick={handleNext}>
                            Complete Setup
                        </Button>
                    </Stack>
                </Paper>
            )}
        </Box>
    );
}
