import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { fetchServiceLogs } from "../utils/logs.js";

export default function LogsViewer({ open, onClose, job, targetCredential }) {
  const [limit, setLimit] = useState(200);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!open || !job) return;
      setLoading(true);
      setError("");
      try {
        const serviceName = job.service_name || job.service;
        const projectId = job.project_id || job.client_project || job.tenant_id;
        const region = job.region || "us-central1";
        const data = await fetchServiceLogs({
          serviceAccount: targetCredential?.credential,
          projectId,
          serviceName,
          region,
          limit,
        });
        setLogs(data?.entries || []);
      } catch (e) {
        setError(e.message || "Failed to load logs");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [open, job, limit, targetCredential]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h6">Logs</Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <TextField
            label="Limit"
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 100)}
            size="small"
            sx={{ width: 120 }}
          />
          <Button onClick={() => setLimit(limit)} disabled={loading}>
            Reload
          </Button>
        </Stack>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {loading ? <CircularProgress /> : null}
        <Box
          component="pre"
          sx={{
            background: "#0b1120",
            color: "#e2e8f0",
            p: 2,
            borderRadius: 1,
            maxHeight: 400,
            overflow: "auto",
            fontSize: 12,
          }}
        >
          {logs.map((entry, idx) => {
            const ts = entry.timestamp || entry.receiveTimestamp || "";
            const text = entry.textPayload || JSON.stringify(entry.jsonPayload || entry, null, 2);
            return (
              <div key={idx} style={{ marginBottom: 8 }}>
                <div style={{ color: "#94a3b8" }}>{ts}</div>
                <div>{text}</div>
              </div>
            );
          })}
          {logs.length === 0 && !loading ? "No logs." : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

LogsViewer.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  job: PropTypes.object,
  targetCredential: PropTypes.object,
};
