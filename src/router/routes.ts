export type RoutePath =
  | "/"
  | "/problem"
  | "/architecture"
  | "/lifecycle"
  | "/protocols"
  | "/routing"
  | "/source"
  | "/security"
  | "/status"
  | "/deploy"
  | "/project";

export type SubsystemGroup = "Thesis" | "System Core" | "Wire & Routing" | "Trust & Operations";

export type GatewaySignalMode =
  | "converge"
  | "mesh"
  | "schematic"
  | "pulse"
  | "translate"
  | "dispatch"
  | "source"
  | "shield"
  | "matrix"
  | "terminal"
  | "open";

export interface RouteDefinition {
  path: RoutePath;
  order: number;
  index: string;
  label: string;
  shortLabel: string;
  group: SubsystemGroup;
  primaryNav?: boolean;
  signalMode: GatewaySignalMode;
  packetTag: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
}

export const ROUTES: RouteDefinition[] = [
  {
    path: "/",
    order: 0,
    index: "00",
    label: "Gateway Overview",
    shortLabel: "Home",
    group: "Thesis",
    signalMode: "converge",
    packetTag: "ENTRY · 127.0.0.1:8080",
    summary: "Architectural overview of YAG: one C17 local gateway between applications and inference servers.",
    seoTitle: "YAG — Yet Another Gateway · Self-Hosted Inference Gateway",
    seoDescription:
      "Experimental C17 inference gateway providing one local HTTP entry point for authentication, exact-model routing, and bounded protocol adaptation.",
  },
  {
    path: "/problem",
    order: 1,
    index: "01",
    label: "The Problem",
    shortLabel: "Problem",
    group: "Thesis",
    primaryNav: true,
    signalMode: "mesh",
    packetTag: "TOPOLOGY · N×M → N→1→M",
    summary: "Why fragmented endpoints and duplicated upstream secrets turn local inference into connection sprawl.",
    seoTitle: "The Problem · YAG — Yet Another Gateway",
    seoDescription:
      "Interactive comparison of fragmented client-to-backend inference meshes versus a single host-side gateway boundary.",
  },
  {
    path: "/architecture",
    order: 2,
    index: "02",
    label: "System Architecture",
    shortLabel: "Architecture",
    group: "System Core",
    primaryNav: true,
    signalMode: "schematic",
    packetTag: "SCHEMATIC · HOST C17",
    summary: "Interactive blueprint of listener, constant-time auth, protocol dispatch, model routes and upstreams.",
    seoTitle: "System Architecture · YAG — Yet Another Gateway",
    seoDescription:
      "Explore every component of the YAG C17 host binary, from POSIX socket admission to libcurl upstream forwarding.",
  },
  {
    path: "/lifecycle",
    order: 3,
    index: "03",
    label: "Request Lifecycle",
    shortLabel: "Lifecycle",
    group: "System Core",
    primaryNav: true,
    signalMode: "pulse",
    packetTag: "TRACE · 01 ADMIT → 07 OBSERVE",
    summary: "Step-by-step deterministic signal tracer across all seven stages of request handling.",
    seoTitle: "Request Lifecycle · YAG — Yet Another Gateway",
    seoDescription:
      "Trace a request from socket admission and pre-body header authentication through route selection, SSE relay, and ephemeral metrics.",
  },
  {
    path: "/protocols",
    order: 4,
    index: "04",
    label: "Protocol Landscape",
    shortLabel: "Protocols",
    group: "Wire & Routing",
    primaryNav: true,
    signalMode: "translate",
    packetTag: "WIRE · CHAT / RESPONSES / MESSAGES",
    summary: "Interactive wire-format inspector showing Chat passthrough vs. bounded Responses and Anthropic adapters.",
    seoTitle: "Protocol Landscape · YAG — Yet Another Gateway",
    seoDescription:
      "Inspect how YAG forwards OpenAI Chat Completions and translates bounded subsets of OpenAI Responses and Anthropic Messages.",
  },
  {
    path: "/routing",
    order: 5,
    index: "05",
    label: "Model Routing",
    shortLabel: "Routing",
    group: "Wire & Routing",
    primaryNav: true,
    signalMode: "dispatch",
    packetTag: "DISPATCH · YAG_MODEL_ROUTES[16]",
    summary: "Interactive exact-match routing table, key_env secret indirection, and circuit-breaker admission.",
    seoTitle: "Model Routing · YAG — Yet Another Gateway",
    seoDescription:
      "Experiment with YAG_MODEL_ROUTES exact string matching, host-side key_env resolution, and opt-in connection-failure fallback.",
  },
  {
    path: "/source",
    order: 6,
    index: "06",
    label: "Source Explorer",
    shortLabel: "Source",
    group: "System Core",
    primaryNav: true,
    signalMode: "source",
    packetTag: "ATLAS · HOST / PROTOCOLS / TESTS",
    summary: "Split-screen atlas of real C17 host files, CMake build rules, and Python mock contract tests.",
    seoTitle: "Source Explorer · YAG — Yet Another Gateway",
    seoDescription:
      "Read verbatim C17 source excerpts from server.c, config.c, openai.c, protocol adapters, and mock-upstream contract tests.",
  },
  {
    path: "/security",
    order: 7,
    index: "07",
    label: "Security Boundaries",
    shortLabel: "Security",
    group: "Trust & Operations",
    signalMode: "shield",
    packetTag: "TRUST · HOST BOUNDARY & HARD CAPS",
    summary: "Six-layer trust cross-section: what YAG enforces at the socket and what it explicitly does not implement.",
    seoTitle: "Security Boundaries · YAG — Yet Another Gateway",
    seoDescription:
      "Transparent threat model covering host-only upstream credentials, framing caps, and absent features like native TLS and audit logs.",
  },
  {
    path: "/status",
    order: 8,
    index: "08",
    label: "Project Status",
    shortLabel: "Status",
    group: "Trust & Operations",
    primaryNav: true,
    signalMode: "matrix",
    packetTag: "MATRIX · IMPLEMENTED VS MOCK",
    summary: "Expandable qualification matrix distinguishing implemented paths, mock-tested adapters, and unverified models.",
    seoTitle: "Project Status · YAG — Yet Another Gateway",
    seoDescription:
      "Clear engineering ledger separating implemented host behavior, mock-qualified CLI tests, unverified real models, and out-of-scope features.",
  },
  {
    path: "/deploy",
    order: 9,
    index: "09",
    label: "Deployment & Quickstart",
    shortLabel: "Deploy",
    group: "Trust & Operations",
    signalMode: "terminal",
    packetTag: "RUNBOOK · BUILD & VERIFY",
    summary: "Guided command builder for Linux native builds, Ollama local upstream, Docker, and the Colibri LAN stack.",
    seoTitle: "Deployment & Quickstart · YAG — Yet Another Gateway",
    seoDescription:
      "Build the C17 binary with CMake, configure YAG_API_KEY and YAG_UPSTREAM_URL, verify /health, and run your first request.",
  },
  {
    path: "/project",
    order: 10,
    index: "10",
    label: "Open Source & Scope",
    shortLabel: "Project",
    group: "Thesis",
    signalMode: "open",
    packetTag: "COLOPHON · MIT · OAKVX/YAG",
    summary: "MIT license, scope philosophy, repository map, and how to contribute real-backend qualification reports.",
    seoTitle: "Open Source & Contribution · YAG — Yet Another Gateway",
    seoDescription:
      "Explore the oakvx/yag repository structure, MIT license, experimental scope philosophy, and open qualification tasks.",
  },
];

const ROUTE_SET = new Set<string>(ROUTES.map((r) => r.path));

export function isRoutePath(value: string): value is RoutePath {
  return ROUTE_SET.has(value);
}

export function getRouteDef(path: RoutePath): RouteDefinition {
  return ROUTES.find((r) => r.path === path) ?? ROUTES[0];
}

export function getAdjacentRoutes(path: RoutePath): { prev: RouteDefinition | null; next: RouteDefinition | null } {
  const current = getRouteDef(path);
  const prev = ROUTES.find((r) => r.order === current.order - 1) ?? null;
  const next = ROUTES.find((r) => r.order === current.order + 1) ?? null;
  return { prev, next };
}
