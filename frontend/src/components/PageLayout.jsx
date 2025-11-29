import PropTypes from "prop-types";
import { alpha, Box, Container, Divider, Stack, Typography } from "@mui/material";

function HeaderSection({ title, subtitle, actions, maxWidth }) {
  const containerProps = maxWidth === false ? { maxWidth: false, disableGutters: true } : { maxWidth };

  return (
    <Box
      component="header"
      sx={(theme) => ({
        background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
        color: theme.palette.primary.contrastText,
        boxShadow: `0 10px 30px ${alpha(theme.palette.primary.dark, 0.2)}`,
        borderBottom: `1px solid ${alpha(theme.palette.common.white, 0.2)}`,
      })}
    >
      <Container
        {...containerProps}
        sx={{
          px: { xs: 3, md: 6 },
          py: { xs: 3, md: 4 },
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={{ xs: 2, md: 3 }}
          alignItems={{ xs: "flex-start", md: "center" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="overline" sx={{ opacity: 0.8, letterSpacing: 2 }}>
              Thunderdeploy Control Center
            </Typography>
            <Typography variant="h4">{title}</Typography>
            {subtitle && (
              <Typography variant="body1" sx={{ opacity: 0.9, maxWidth: 720 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {actions && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
              {actions}
            </Stack>
          )}
        </Stack>
      </Container>
      <Divider sx={{ opacity: 0.2 }} />
    </Box>
  );
}

HeaderSection.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  actions: PropTypes.node,
  maxWidth: PropTypes.oneOfType([PropTypes.oneOf(["xs", "sm", "md", "lg", "xl"]), PropTypes.bool]),
};

export default function PageLayout({
  title,
  subtitle,
  actions,
  maxWidth = "lg",
  disableContainer = false,
  containerSx = {},
  children,
}) {
  const contentContainerProps = maxWidth === false ? { maxWidth: false, disableGutters: true } : { maxWidth };

  return (
    <Box sx={{ minHeight: "100vh", backgroundColor: "background.default", color: "text.primary" }}>
      <HeaderSection title={title} subtitle={subtitle} actions={actions} maxWidth={maxWidth} />
      <Container
        {...contentContainerProps}
        disableGutters={disableContainer || maxWidth === false}
        sx={{
          px: disableContainer || maxWidth === false ? { xs: 0 } : { xs: 3, md: 6 },
          py: { xs: 3, md: 4 },
          display: "flex",
          flexDirection: "column",
          gap: { xs: 3, md: 4 },
          ...containerSx,
        }}
      >
        {children}
      </Container>
    </Box>
  );
}

PageLayout.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  actions: PropTypes.node,
  maxWidth: PropTypes.oneOfType([PropTypes.oneOf(["xs", "sm", "md", "lg", "xl"]), PropTypes.bool]),
  disableContainer: PropTypes.bool,
  containerSx: PropTypes.object,
  children: PropTypes.node,
};
