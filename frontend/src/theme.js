import { createTheme } from "@mui/material/styles";
import { alpha } from "@mui/material";

const primaryMain = "#0a6ed1";
const primaryDark = "#0854a0";
const accent = "#1c97ea";
const shellBackground = "#f4f6f9";
const paperBorder = "#d9e2ef";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: primaryMain,
      dark: primaryDark,
      light: accent,
      contrastText: "#ffffff",
    },
    secondary: {
      main: primaryDark,
    },
    background: {
      default: shellBackground,
      paper: "#ffffff",
    },
    divider: paperBorder,
    text: {
      primary: "#1f2d3d",
      secondary: "#52627a",
    },
    success: {
      main: "#2b7c2b",
    },
    warning: {
      main: "#e9730c",
    },
    error: {
      main: "#d6453d",
    },
    info: {
      main: "#107eab",
    },
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily: '"72", "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h4: {
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
    h5: {
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          borderColor: paperBorder,
          boxShadow: "0 6px 18px rgba(15, 38, 71, 0.08)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: 999,
          fontWeight: 600,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 500,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          marginInline: 4,
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: alpha(primaryMain, 0.08),
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
          color: "#1f2d3d",
        },
      },
    },
  },
});

export default theme;
