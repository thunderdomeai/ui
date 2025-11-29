import { useState } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Paper,
  CircularProgress,
  Alert,
  Snackbar,
} from "@mui/material";
import { RocketLaunch } from "@mui/icons-material";

const TRIGGER_SERVICE_BASE_URL = "https://triggerservice-497847265153.us-central1.run.app";

export default function TenantProvisioningForm({ serviceAccount, customerServiceAccount }) {
  const [formData, setFormData] = useState({
    clientName: "",
    projectId: "",
    region: "us-central1",
    dbAlias: "default",
    users: "",
  });
  const [deploying, setDeploying] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState(null);
  const [deploymentLog, setDeploymentLog] = useState("");
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDeploy = async () => {
    if (!serviceAccount || !customerServiceAccount) {
      setSnackbarMessage("Please upload both Source and Target Service Accounts in the Credential Manager first.");
      setSnackbarOpen(true);
      return;
    }

    if (!formData.clientName || !formData.projectId) {
      setSnackbarMessage("Client Name and Project ID are required.");
      setSnackbarOpen(true);
      return;
    }

    setDeploying(true);
    setDeploymentStatus(null);
    setDeploymentLog("Submitting tenant provisioning job...");

    const tenantConfig = {
      tenant_config: {
        client_name: formData.clientName,
        project_id: formData.projectId,
        region: formData.region,
        db_alias: formData.dbAlias,
        users: formData.users,
      },
    };

    const formDataObj = new FormData();
    formDataObj.append("userrequirements.json", new Blob([JSON.stringify(tenantConfig)], { type: "application/json" }), "userrequirements.json");
    formDataObj.append("serviceaccount.json", new Blob([JSON.stringify(serviceAccount)], { type: "application/json" }), "serviceaccount.json");
    formDataObj.append("customer_serviceaccount.json", new Blob([JSON.stringify(customerServiceAccount)], { type: "application/json" }), "customer_serviceaccount.json");

    try {
      const response = await fetch(`${TRIGGER_SERVICE_BASE_URL}/trigger`, {
        method: "POST",
        body: formDataObj,
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || `HTTP ${response.status}`);
      }

      setDeploymentStatus("success");
      setDeploymentLog(`Job submitted successfully. \nResponse: ${JSON.stringify(responseData, null, 2)}`);
    } catch (error) {
      console.error("Error triggering deployment:", error);
      setDeploymentStatus("error");
      setDeploymentLog(`Error: ${error.message}`);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 800, mx: "auto" }}>
      <Typography variant="h5" gutterBottom sx={{ color: "primary.main", fontWeight: 600 }}>
        Provision New Tenant
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Deploy a full Agent One stack for a new tenant. This includes the Broker, MCP, and database configuration.
      </Typography>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Client Name"
            name="clientName"
            value={formData.clientName}
            onChange={handleChange}
            helperText="Unique identifier for the client (e.g., acme-corp)"
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="GCP Project ID"
            name="projectId"
            value={formData.projectId}
            onChange={handleChange}
            helperText="Target GCP Project ID"
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Region"
            name="region"
            value={formData.region}
            onChange={handleChange}
            helperText="GCP Region (default: us-central1)"
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Database Alias"
            name="dbAlias"
            value={formData.dbAlias}
            onChange={handleChange}
            helperText="Alias for the MCP database (default: default)"
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Users (Comma Separated)"
            name="users"
            value={formData.users}
            onChange={handleChange}
            helperText="List of user IDs to map to this tenant"
          />
        </Grid>

        <Grid item xs={12} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            color="primary"
            size="large"
            startIcon={deploying ? <CircularProgress size={20} color="inherit" /> : <RocketLaunch />}
            onClick={handleDeploy}
            disabled={deploying}
            fullWidth
          >
            {deploying ? "Provisioning..." : "Provision Tenant"}
          </Button>
        </Grid>
      </Grid>

      {deploymentLog && (
        <Box sx={{ mt: 3 }}>
          <Alert severity={deploymentStatus === "error" ? "error" : "success"}>
            <Typography variant="subtitle2" fontWeight="bold">
              {deploymentStatus === "error" ? "Deployment Failed" : "Deployment Initiated"}
            </Typography>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "0.85rem", marginTop: "8px" }}>
              {deploymentLog}
            </pre>
          </Alert>
        </Box>
      )}

      <Snackbar open={snackbarOpen} autoHideDuration={6000} onClose={() => setSnackbarOpen(false)} message={snackbarMessage} />
    </Paper>
  );
}

TenantProvisioningForm.propTypes = {
  serviceAccount: PropTypes.object,
  customerServiceAccount: PropTypes.object,
};
