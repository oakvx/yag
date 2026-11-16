import { useEffect, useState } from "react";
import { ConsoleEnvironment } from "./xmb/ConsoleEnvironment";
import { ArchitecturePage } from "./pages/ArchitecturePage";
import { DeployPage } from "./pages/DeployPage";
import { HomePage } from "./pages/HomePage";
import { LifecyclePage } from "./pages/LifecyclePage";
import { ProblemPage } from "./pages/ProblemPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProtocolsPage } from "./pages/ProtocolsPage";
import { RoutingPage } from "./pages/RoutingPage";
import { SecurityPage } from "./pages/SecurityPage";
import { SourcePage } from "./pages/SourcePage";
import { StatusPage } from "./pages/StatusPage";
import { ConfigurationPage, OperationsPage, SystemInfoPage } from "./pages/SystemUtilities";
import { ProfilePage } from "./pages/ProfilePage";
import { ThemeSettingsPage } from "./pages/ThemeSettings";
import { TrophiesPage } from "./pages/TrophiesPage";
import { CardPage } from "./components/CardPage";
import { RouterProvider, useRouter } from "./router/RouterContext";
import type { RoutePath } from "./router/routes";
import { WorkspaceShell } from "./workspace/WorkspaceShell";
import { WorkspaceOverview } from "./workspace/WorkspaceOverview";
import { WorkspaceSettings } from "./workspace/WorkspaceSettings";
import { WorkspacePreferences } from "./workspace/preferences";

/** The console is the site. Workspace View is an optional reading mode opened with ?workspace=1. */
type Mode = "console" | "workspace";

function ActiveRouteView({ mode, onConsole }: { mode: Mode; onConsole: () => void }) {
  const { path, query } = useRouter();

  if (query.view === "workspace" || query.workspace === "1") return null;
  if (path === "/" && query.view === "system") return <SystemInfoPage />;
  if (path === "/deploy" && query.view === "configuration") return <ConfigurationPage />;
  if (path === "/deploy" && query.view === "operations") return <OperationsPage />;
  if (mode === "workspace" && path === "/") return <WorkspaceOverview />;
  if (mode === "workspace" && path === "/theme") return <WorkspaceSettings onConsole={onConsole} />;

  const views: Record<RoutePath, () => React.JSX.Element> = {
    "/": HomePage,
    "/problem": ProblemPage,
    "/architecture": ArchitecturePage,
    "/lifecycle": LifecyclePage,
    "/protocols": ProtocolsPage,
    "/routing": RoutingPage,
    "/source": SourcePage,
    "/security": SecurityPage,
    "/status": StatusPage,
    "/deploy": DeployPage,
    "/project": ProjectPage,
    "/profile": ProfilePage,
    "/theme": ThemeSettingsPage,
    "/trophies": TrophiesPage,
  };

  const Component = views[path] ?? HomePage;
  const plain = path === "/theme" || path === "/trophies";
  return plain ? <Component /> : <CardPage><Component /></CardPage>;
}

function Application() {
  const { path, query, navigate } = useRouter();
  const wantsWorkspace = query.view === "workspace" || query.workspace === "1";
  const [mode, setMode] = useState<Mode>(() => (wantsWorkspace ? "workspace" : "console"));

  // Keep document parameters (view, file, etc.) while removing only the mode marker.
  useEffect(() => {
    if (!wantsWorkspace) return;
    setMode("workspace");
    const params = new URLSearchParams(query);
    params.delete("workspace");
    if (params.get("view") === "workspace") params.delete("view");
    const search = params.toString();
    navigate(path + (search ? `?${search}` : ""), { replace: true });
  }, [path, query, wantsWorkspace, navigate]);

  const returnToConsole = () => {
    setMode("console");
    navigate("/", { replace: true });
  };

  if (mode === "workspace") {
    return (
      <WorkspaceShell onConsole={returnToConsole}>
        <ActiveRouteView mode="workspace" onConsole={returnToConsole} />
      </WorkspaceShell>
    );
  }

  return (
    <ConsoleEnvironment>
      <ActiveRouteView mode="console" onConsole={returnToConsole} />
    </ConsoleEnvironment>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <WorkspacePreferences>
        <Application />
      </WorkspacePreferences>
    </RouterProvider>
  );
}
