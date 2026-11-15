import { useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { XmbRow } from "@/components/XmbRow";
import { XmbScreen } from "@/components/XmbScreen";
import { REPO_LINKS } from "@/data/repository";
import { useRouter } from "@/router/RouterContext";

type DeployTarget = "openai-local" | "ollama" | "lan-colibri";

const QUICKSTART = `# 1 · Install the host toolchain (Debian / Ubuntu)
sudo apt install build-essential cmake libcurl4-openssl-dev

# 2 · Clone and build
git clone https://github.com/oakvx/yag && cd yag
cmake -S . -B build
cmake --build build -j

# 3 · Configure and run on loopback
export YAG_API_KEY="$(openssl rand -hex 32)"
export YAG_UPSTREAM_URL="http://127.0.0.1:11434/v1"
./build/yag

# 4 · Verify from another terminal
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/v1/models \\
  -H "Authorization: Bearer $YAG_API_KEY"`;

export function DeployPage() {
  const { query } = useRouter();
  const view = query.view === "quickstart" ? "quickstart" : "runbook";
  const [target, setTarget] = useState<DeployTarget>("ollama");
  const [withConsole, setWithConsole] = useState(true);
  const [withTests, setWithTests] = useState(true);
  const [withRateLimit, setWithRateLimit] = useState(false);

  const depsCmd = `sudo apt install build-essential cmake libcurl4-openssl-dev${
    withTests || target === "lan-colibri" ? " python3" : ""
  }${withConsole ? " nodejs npm" : ""}`;

  const buildCmd = [
    "git clone https://github.com/oakvx/yag && cd yag",
    "cmake -S . -B build",
    "cmake --build build -j",
    ...(withConsole ? ["cd console && npm ci && npm run build && cd .."] : []),
    ...(withTests ? ["ctest --test-dir build --output-on-failure"] : []),
  ].join("\n");

  const upstreamUrl =
    target === "ollama" ? "http://127.0.0.1:11434/v1" : "http://127.0.0.1:8000/v1";

  const envAndRunCmd =
    target === "lan-colibri"
      ? `# Central LAN AI server (Colibri) with private CA, scoped keys, and private Ollama port
python scripts/lan.py init --lan-ip 192.168.1.50 --clients 3 --managed-ollama
python scripts/lan.py doctor
python scripts/lan.py up
python scripts/lan.py model llama3.2
python scripts/lan.py ca
python scripts/lan.py check`
      : [
          "# Secrets belong in your service manager / private environment — never in public files",
          'export YAG_API_KEY="$(openssl rand -hex 32)"',
          `export YAG_UPSTREAM_URL="${upstreamUrl}"`,
          ...(target === "openai-local" ? ['# export YAG_UPSTREAM_KEY="YOUR_UPSTREAM_SECRET"'] : []),
          ...(withRateLimit ? ["export YAG_RATE_LIMIT_PER_MINUTE=60"] : []),
          "",
          "./build/yag",
        ].join("\n");

  const verifyCmd =
    target === "lan-colibri"
      ? `# After installing the generated private CA root on the client PC:
curl https://192.168.1.50/health

curl https://192.168.1.50/v1/models \\
  -H "Authorization: Bearer $CLIENT_SCOPED_KEY"`
      : `# 01 · Public liveness probe
curl http://127.0.0.1:8080/health

# 02 · Authenticated model discovery
curl http://127.0.0.1:8080/v1/models \\
  -H "Authorization: Bearer $YAG_API_KEY"

# 03 · First Chat Completions request
curl http://127.0.0.1:8080/v1/chat/completions \\
  -H "Authorization: Bearer $YAG_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"YOUR_MODEL_ID","messages":[{"role":"user","content":"Hello"}],"stream":false}'`;

  const profiles: DeployTarget[] = ["ollama", "openai-local", "lan-colibri"];
  return <XmbScreen document={<p>Build the native C17 host, choose an upstream, and keep the listener on loopback until its trust boundary is configured. The settings below assemble copyable commands for local servers or a private-CA LAN deployment.</p>} key={view} initialSection={view === "quickstart" ? 3 : undefined}
    subtitle="Assemble copyable commands for a local host or private-CA LAN deployment." sections={[
    { id: "configuration", label: "Deployment settings", entries: [
      { key: "target", title: "Upstream profile", value: { ollama: "Local Ollama", "openai-local": "Local /v1 server", "lan-colibri": "Colibri LAN hub" }[target],
        activate: () => setTarget(profiles[(profiles.indexOf(target) + 1) % profiles.length]), description: "Select to cycle the upstream topology. Commands below update immediately.",
        panel: <p>Ollama uses 127.0.0.1:11434/v1. A local OpenAI-compatible server uses 127.0.0.1:8000/v1. Colibri provisions Compose, a Caddy reverse proxy and a private CA.</p> },
      { key: "console", title: "Build React Console", value: withConsole ? "On" : "Off", activate: () => setWithConsole(!withConsole), description: "Requires Node and npm. API-only deployments can skip the browser bundle." },
      { key: "tests", title: "Run CTest suites", value: withTests ? "On" : "Off", activate: () => setWithTests(!withTests), description: "Requires Python 3.9+. Tests run against deterministic mock upstreams." },
      ...(target !== "lan-colibri" ? [{ key: "rate", title: "60 RPM rate limit", value: withRateLimit ? "On" : "Off", activate: () => setWithRateLimit(!withRateLimit), description: "A fixed 60-second rate window per authenticated key." }] : []),
      { key: "bind", title: "Default bind", value: "127.0.0.1:8080" },
      { key: "key", title: "Primary key", value: "At least 16 characters", description: "Read from the private environment. Static configuration changes require a restart." },
    ] },
    { id: "dependencies", label: "Dependencies", entries: [
      { key: "host", title: "Native host", value: "Required", description: "Linux, POSIX sockets, pthreads, a C17 compiler, CMake 3.16+ and libcurl development headers." },
      { key: "json", title: "yyjson 0.12.0", value: "Vendored", description: "Included under third_party/yyjson; no external C package manager is used." },
      { key: "node", title: "Node & npm", value: "Optional", description: "Only required to compile console/dist." },
      { key: "python", title: "Python 3.9+", value: "Optional", description: "Needed for contract tests and scripts/lan.py." },
      { key: "docker", title: "Docker Compose v2", value: "Optional", description: "Needed for container and Colibri LAN hub modes." },
    ] },
    { id: "commands", label: "Guided runbook", entries: [
      { key: "install", title: "Install packages", value: "Step 1", description: "Debian / Ubuntu toolchain.", panel: <CodeBlock code={depsCmd} lang="bash" path="Host dependencies" showLineNumbers={false} /> },
      { key: "build", title: "Clone, compile & test", value: "Step 2", description: "Produces ./build/yag and optional console/dist.", panel: <CodeBlock code={buildCmd} lang="bash" path="CMake & optional Console" showLineNumbers={false} /> },
      { key: "run", title: "Configure & start", value: "Step 3", description: "Keep secrets in a private environment; never commit them to public files.", panel: <CodeBlock code={envAndRunCmd} lang="bash" path={target === "lan-colibri" ? "scripts/lan.py" : "Runtime environment"} href={target === "lan-colibri" ? REPO_LINKS.lanHubDoc : REPO_LINKS.run} showLineNumbers={false} /> },
      { key: "verify", title: "Verify the gateway", value: "Step 4", description: "Check liveness, model discovery and the first inference call.", panel: <CodeBlock code={verifyCmd} lang="bash" path="Verification commands" showLineNumbers={false} /> },
    ] },
    { id: "quickstart", label: "Quickstart", entries: [
      { key: "quickstart", title: "Build & run on loopback", value: "Four steps", description: "Commands from the repository README, for a local Linux machine.", panel: <CodeBlock code={QUICKSTART} lang="bash" path="README · build / run" href={REPO_LINKS.build} showLineNumbers={false} /> },
    ] },
    { id: "guides", label: "Deployment guides", entries: [
      { key: "releases", title: "Host and Desktop packages", description: "Release workflows build the Linux Host archive and native Windows, macOS and Linux Desktop installers. Verify checksums and provenance for the exact reviewed tag. A candidate package does not prove real-model compatibility.", panel: <><p>Host packages target Linux. Desktop packages are clients for Windows, macOS and Linux; they do not turn those platforms into native Host servers.</p><p>Reviewed releases include SHA-256 checksums and build provenance. Candidate acceptance, real-model qualification and stable publication are separate steps.</p><XmbRow href={REPO_LINKS.releasesDoc}>Read release and verification instructions</XmbRow></> },
      { key: "docker-doc", title: "Docker deployment", href: REPO_LINKS.dockerDoc },
      { key: "lan-doc", title: "LAN hub guide", href: REPO_LINKS.lanHubDoc },
      { key: "ollama-doc", title: "Ollama integration", href: REPO_LINKS.ollamaDoc },
      { key: "security", title: "Security boundaries", to: "/security", description: "Review the trust boundaries before exposing a listener beyond loopback." },
    ] },
  ]} />;
}
