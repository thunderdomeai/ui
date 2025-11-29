import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  AppBar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
  Divider,
  Button,
} from "@mui/material";
import {
  Dashboard as DashboardIcon,
  Settings as SettingsIcon,
  Security as SecurityIcon,
  Storage as StorageIcon,
  CloudUpload as CloudUploadIcon,
  Build as BuildIcon,
  HealthAndSafety as HealthIcon,
  Menu as MenuIcon,
  IntegrationInstructions as AgentIcon,
} from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import DashboardPage from "./pages/DashboardPage.jsx";
import OnboardingPage from "./pages/OnboardingPage.jsx";
import PermissionsPage from "./pages/PermissionsPage.jsx";
import PrimingPage from "./pages/PrimingPage.jsx";
import AIConfiguratorPage from "./pages/AIConfiguratorPage.jsx";
import HealthPage from "./pages/HealthPage.jsx";
import CredentialsPage from "./pages/CredentialsPage.jsx";
import ActiveDeploymentsPage from "./pages/ActiveDeploymentsPage.jsx";
import TenantDetailPage from "./pages/TenantDetailPage.jsx";
import ThunderdeployPage from "./pages/ThunderdeployPage.jsx";
import { useConfig } from "./hooks/useConfig.js";

const drawerWidth = 260;

const navItems = [
  { label: "Overview", path: "/", icon: <DashboardIcon /> },
  { label: "Onboarding", path: "/onboarding", icon: <SettingsIcon /> },
  { label: "Permissions", path: "/permissions", icon: <SecurityIcon /> },
  { label: "Priming", path: "/priming", icon: <StorageIcon /> },
  { label: "Credentials", path: "/credentials", icon: <SecurityIcon /> },
  { label: "Deploy", path: "/deploy", icon: <CloudUploadIcon /> },
  { label: "AI Configurator", path: "/ai", icon: <AgentIcon /> },
  { label: "Health", path: "/health", icon: <HealthIcon /> },
  { label: "Tenants", path: "/tenants", icon: <HealthIcon /> },
];

function NavList({ onNavigate }) {
  const location = useLocation();
  const theme = useTheme();

  return (
    <List sx={{ py: 2 }}>
      {navItems.map((item) => {
        const selected = location.pathname === item.path;
        return (
          <ListItem key={item.path} disablePadding>
            <ListItemButton
              selected={selected}
              onClick={() => onNavigate(item.path)}
              sx={{
                mx: 1,
                borderRadius: 2,
                "&.Mui-selected": {
                  backgroundColor: theme.palette.primary.main + "10",
                  color: theme.palette.primary.main,
                },
              }}
            >
              <ListItemIcon sx={{ color: selected ? theme.palette.primary.main : "inherit" }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
}

export default function App() {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up("md"));
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { configSummary } = useConfig();

  const handleNavigate = (path) => {
    navigate(path);
    if (!isMdUp) {
      setMobileOpen(false);
    }
  };

  const drawer = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 3, pt: 3, pb: 1 }}>
        <Typography variant="h6" fontWeight={700}>
          Thunder Unified UI
        </Typography>
        <Typography variant="body2" color="text.secondary">
          TriggerService-first deployments
        </Typography>
      </Box>
      <NavList onNavigate={handleNavigate} />
      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Bound endpoints
        </Typography>
        {configSummary.map((item) => (
          <Box key={item.label} sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                mr: 1,
                backgroundColor: item.enabled ? "success.main" : "grey.400",
              }}
            />
            <Typography variant="body2">{item.label}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", height: "100vh", backgroundColor: "background.default" }}>
      <AppBar position="fixed" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ display: "flex", gap: 2 }}>
          {!isMdUp && (
            <IconButton edge="start" color="inherit" onClick={() => setMobileOpen((open) => !open)} aria-label="menu">
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Unified Control Plane
          </Typography>
          <Button
            variant="contained"
            startIcon={<BuildIcon />}
            onClick={() => handleNavigate("/deploy")}
          >
            Launch Deploy
          </Button>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant={isMdUp ? "permanent" : "temporary"}
          open={isMdUp ? true : mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
              borderRight: 1,
              borderColor: "divider",
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, mt: 8, overflow: "auto" }}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/permissions" element={<PermissionsPage />} />
          <Route path="/priming" element={<PrimingPage />} />
          <Route path="/credentials" element={<CredentialsPage />} />
          <Route path="/deploy" element={<ThunderdeployPage />} />
          <Route path="/ai" element={<AIConfiguratorPage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/tenants" element={<ActiveDeploymentsPage />} />
          <Route path="/tenants/:tenantId" element={<TenantDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Box>
    </Box>
  );
}
