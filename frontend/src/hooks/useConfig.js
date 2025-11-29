import { useMemo } from "react";

export function useConfig() {
  const config = useMemo(() => {
    if (typeof window === "undefined") return {};
    return window.__UNIFIED_UI_CONFIG__ || {};
  }, []);

  const configSummary = useMemo(() => {
    const entries = [
      { label: "Main API", enabled: !!config.MAIN_API_URL },
      { label: "MCP Registry", enabled: !!config.MCP_REGISTRY_BASE_URL },
      { label: "TriggerService", enabled: !!config.THUNDERDEPLOY_BASE_URL },
      { label: "Web Research", enabled: !!config.WEB_RESEARCH_BASE_URL },
      { label: "Cheat Sheet", enabled: !!config.CHEATSHEET_BASE_URL },
    ];
    return entries;
  }, [config]);

  return { config, configSummary };
}
