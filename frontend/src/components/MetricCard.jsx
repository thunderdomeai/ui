import PropTypes from "prop-types";
import { Box, Paper, Typography } from "@mui/material";

export default function MetricCard({ label, value, helper, color = "text.primary" }) {
  return (
    <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {label}
      </Typography>
      <Typography variant="h5" fontWeight={700} color={color}>
        {value}
      </Typography>
      {helper ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {helper}
        </Typography>
      ) : null}
    </Paper>
  );
}

MetricCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  helper: PropTypes.string,
  color: PropTypes.string,
};
