import PropTypes from "prop-types";
import { Chip } from "@mui/material";

const palette = {
  healthy: { color: "success", label: "Healthy" },
  degraded: { color: "warning", label: "Degraded" },
  down: { color: "error", label: "Down" },
  pending: { color: "default", label: "Pending" },
};

export default function StatusChip({ status, label }) {
  const lower = (status || "").toLowerCase();
  const mapping = palette[lower] || { color: "default", label: status || "Unknown" };
  return <Chip size="small" color={mapping.color} label={label || mapping.label} />;
}

StatusChip.propTypes = {
  status: PropTypes.string,
  label: PropTypes.string,
};
