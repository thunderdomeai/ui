import PropTypes from "prop-types";
import { Box, Paper, Typography } from "@mui/material";

export default function SectionCard({ title, subtitle, action, children, sx }) {
  return (
    <Paper elevation={0} sx={{ p: 3, ...sx }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={subtitle ? 1 : 2}>
        <Box>
          <Typography variant="h6" fontWeight={700}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {action}
      </Box>
      {children}
    </Paper>
  );
}

SectionCard.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  action: PropTypes.node,
  children: PropTypes.node,
  sx: PropTypes.object,
};
