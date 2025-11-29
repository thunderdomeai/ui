import PropTypes from "prop-types";
import {
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

function ResultTable({ title, rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        {title}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Detail</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, idx) => (
            <TableRow key={row.name || row.resource || idx}>
              <TableCell>{row.name || row.resource || row.bucket || row.queue || row.job || "—"}</TableCell>
              <TableCell>
                <Chip size="small" label={row.status || "unknown"} color={row.status === "error" ? "error" : row.status === "missing" ? "warning" : "success"} />
              </TableCell>
              <TableCell>{row.detail || row.message || row.error || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

ResultTable.propTypes = {
  title: PropTypes.string.isRequired,
  rows: PropTypes.array,
};

export default function PrimeResultsTable({ result }) {
  if (!result) return null;
  const buckets = result.bucket_results || [];
  const queues = result.task_queue_results || [];
  const jobs = result.scheduler_job_results || [];
  const sas = result.service_account_results || [];
  return (
    <Box>
      <ResultTable title="Buckets" rows={buckets} />
      <ResultTable title="Task Queues" rows={queues} />
      <ResultTable title="Scheduler Jobs" rows={jobs} />
      <ResultTable title="Service Accounts" rows={sas} />
    </Box>
  );
}

PrimeResultsTable.propTypes = {
  result: PropTypes.object,
};
