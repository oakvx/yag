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
import { RouterProvider, useRouter } from "./router/RouterContext";
import type { RoutePath } from "./router/routes";

function ActiveRouteView() {
  const { path, query } = useRouter();

  if (path === "/" && query.view === "system") return <SystemInfoPage />;
  if (path === "/deploy" && query.view === "configuration") return <ConfigurationPage />;
  if (path === "/deploy" && query.view === "operations") return <OperationsPage />;

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
  };

  const Component = views[path] ?? HomePage;
  return <Component />;
}

export default function App() {
  return (
    <RouterProvider>
      <ConsoleEnvironment>
        <ActiveRouteView />
      </ConsoleEnvironment>
    </RouterProvider>
  );
}
