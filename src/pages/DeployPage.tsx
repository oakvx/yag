import { useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import { REPO_LINKS } from "@/data/repository";
import { RouteLink, useRouter } from "@/router/RouterContext";
import { cn } from "@/utils/cn";

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
  const { query, navigate } = useRouter();
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

  return (
    <div>
      <PageMasthead
        path="/deploy"
        eyebrow={view === "quickstart" ? "Quickstart · four steps" : "Guided runbook"}
        title={
          view === "quickstart" ? (
            <>
              Install, build, run, <em>verify.</em>
            </>
          ) : (
            <>
              Compile the host, set two variables, <em>verify on loopback.</em>
            </>
          )
        }
        lede={
          view === "quickstart"
            ? "The shortest documented path from a clean Linux machine to a verified gateway on loopback. Every command is taken from the repository README."
            : "Configure your target environment below to assemble exact, copyable commands from the repository documentation. Mandatory C17 host dependencies are separated from optional test and Console toolchains."
        }
        meta={[
          { k: "Default bind", v: "127.0.0.1:8080", tone: "moss" },
          { k: "Required env", v: "YAG_API_KEY (≥ 16 chars)", tone: "amber" },
          { k: "Config reload", v: "Read once at startup (restart)" },
        ]}
      />

      <div className="px-5 pt-4 @lg:px-8">
        <div role="group" aria-label="Deployment view" className="inline-flex rounded-full border border-line-strong p-1 font-mono text-[10.5px] uppercase tracking-[0.12em]">
          {[
            { id: "runbook", label: "Guided runbook", to: "/deploy" },
            { id: "quickstart", label: "Quickstart", to: "/deploy?view=quickstart" },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => navigate(v.to)}
              className={cn("cursor-pointer rounded-full px-3.5 py-1.5 transition-colors", view === v.id ? "bg-amber/20 text-white" : "text-faint hover:text-paper")}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "quickstart" && (
        <section className="py-6 @lg:py-8">
          <Container>
            <CodeBlock code={QUICKSTART} lang="bash" path="README · build / run" href={REPO_LINKS.build} showLineNumbers={false} />
            <div className="mt-5 grid gap-4 @2xl:grid-cols-2">
              <div className="rounded-2xl border border-line bg-panel/60 p-4 text-[13px] leading-relaxed text-muted">
                <StatusBadge tone="implemented">Required</StatusBadge>
                <p className="mt-2">A C17 compiler, CMake 3.16+, libcurl headers and pthreads. <code className="font-mono text-paper">YAG_API_KEY</code> must be at least 16 characters.</p>
              </div>
              <div className="rounded-2xl border border-line bg-panel/60 p-4 text-[13px] leading-relaxed text-muted">
                <StatusBadge tone="scope">Optional</StatusBadge>
                <p className="mt-2">Node 18+ for the browser Console, Python 3 for the mock-upstream tests, Docker Compose for container and LAN-hub modes — see the guided runbook.</p>
              </div>
            </div>
          </Container>
        </section>
      )}

      {view === "runbook" && (
      <section className="py-6 @lg:py-8">
        <Container>
          {/* Interactive Deployment Configurator */}
          <div className="mb-8 border border-line-strong bg-panel p-4 @lg:p-6">
            <div className="grid gap-6 @3xl:grid-cols-12">
              <div className="@3xl:col-span-6">
                <span className="label block text-amber">01 · Select Upstream / Topology Profile</span>
                <div className="mt-2.5 grid gap-2 @lg:grid-cols-3 font-mono text-[10.5px]">
                  {[
                    { id: "ollama", title: "Local Ollama", sub: "127.0.0.1:11434/v1" },
                    { id: "openai-local", title: "Local /v1 Server", sub: "vLLM / llama.cpp :8000" },
                    { id: "lan-colibri", title: "Colibri LAN Hub", sub: "Private CA + Compose" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTarget(item.id as DeployTarget)}
                      className={cn(
                        "border p-2.5 text-left transition-colors cursor-pointer",
                        target === item.id
                          ? "border-amber bg-amber/15 text-paper"
                          : "border-line text-faint hover:text-paper",
                      )}
                    >
                      <div className="font-medium text-paper">{item.title}</div>
                      <div className="mt-0.5 text-[9.5px] text-faint">{item.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="@3xl:col-span-6 @3xl:border-l @3xl:border-line @3xl:pl-6">
                <span className="label block text-faint">02 · Optional Build & Runtime Steps</span>
                <div className="mt-2.5 flex flex-wrap gap-4 font-mono text-[11px] text-paper">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={withConsole}
                      onChange={(e) => setWithConsole(e.target.checked)}
                      className="accent-[#6ccbff]"
                    />
                    <span>Build React Console (Node 18+)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={withTests}
                      onChange={(e) => setWithTests(e.target.checked)}
                      className="accent-[#6ccbff]"
                    />
                    <span>Run CTest Suite (Python 3)</span>
                  </label>
                  {target !== "lan-colibri" && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={withRateLimit}
                        onChange={(e) => setWithRateLimit(e.target.checked)}
                        className="accent-[#6ccbff]"
                      />
                      <span>Enable 60 RPM Rate Limit</span>
                    </label>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Mandatory vs Optional Dependency Breakdown */}
          <div className="mb-10 grid gap-6 @2xl:grid-cols-2">
            <div className="border border-line bg-panel/60 p-5">
              <StatusBadge tone="implemented">Mandatory Host Dependencies</StatusBadge>
              <ul className="mt-3 space-y-1.5 font-mono text-[11.5px] text-paper">
                <li>· Linux with POSIX sockets &amp; pthreads</li>
                <li>· C17 compiler (GCC / Clang via build-essential)</li>
                <li>· CMake 3.16+</li>
                <li>· libcurl development headers (libcurl4-openssl-dev)</li>
              </ul>
              <p className="mt-2.5 text-[12.5px] text-muted">
                <code className="font-mono text-paper">yyjson 0.12.0</code> is vendored under{" "}
                <code className="font-mono text-paper">third_party/yyjson</code> — no external C package manager is
                used.
              </p>
            </div>

            <div className="border border-line bg-panel/60 p-5">
              <StatusBadge tone="scope">Optional Toolchains</StatusBadge>
              <ul className="mt-3 space-y-1.5 font-mono text-[11.5px] text-muted">
                <li>
                  · <span className="text-paper">Node 18+ &amp; npm:</span> only required if compiling the browser
                  Console (<code className="text-paper">console/dist</code>). API-only deployments can skip it.
                </li>
                <li>
                  · <span className="text-paper">Python 3.9+:</span> only required to run the CTest mock-upstream suites
                  or <code className="text-paper">scripts/lan.py</code>.
                </li>
                <li>
                  · <span className="text-paper">Docker Compose v2:</span> only required for container / Colibri LAN hub
                  mode.
                </li>
              </ul>
            </div>
          </div>

          {/* Step-by-Step Guided Terminal Runbook */}
          <ol className="space-y-6">
            <li className="border-t border-line-strong pt-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-serif text-2xl text-paper">
                  <span className="mr-3 font-mono text-[12px] text-amber">STEP 01</span>
                  Install packages
                </h2>
                <span className="font-mono text-[10.5px] text-faint">Debian / Ubuntu example</span>
              </div>
              <CodeBlock code={depsCmd} lang="bash" path="Host dependencies" showLineNumbers={false} />
            </li>

            <li className="border-t border-line-strong pt-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-serif text-2xl text-paper">
                  <span className="mr-3 font-mono text-[12px] text-amber">STEP 02</span>
                  Clone, compile &amp; run mock contract tests
                </h2>
                <span className="font-mono text-[10.5px] text-faint">Produces ./build/yag</span>
              </div>
              <CodeBlock code={buildCmd} lang="bash" path="CMake & optional Console" showLineNumbers={false} />
            </li>

            <li className="border-t border-line-strong pt-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-serif text-2xl text-paper">
                  <span className="mr-3 font-mono text-[12px] text-amber">STEP 03</span>
                  {target === "lan-colibri"
                    ? "Provision the Colibri private-CA LAN stack"
                    : "Configure environment & start the gateway"}
                </h2>
                <span className="font-mono text-[10.5px] text-faint">
                  {target === "lan-colibri" ? "HTTPS via Caddy + private CA" : "Localhost :8080"}
                </span>
              </div>
              <CodeBlock
                code={envAndRunCmd}
                lang="bash"
                path={target === "lan-colibri" ? "scripts/lan.py" : "Runtime environment"}
                href={target === "lan-colibri" ? REPO_LINKS.lanHubDoc : REPO_LINKS.run}
                showLineNumbers={false}
              />
            </li>

            <li className="border-t border-line-strong pt-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-serif text-2xl text-paper">
                  <span className="mr-3 font-mono text-[12px] text-amber">STEP 04</span>
                  Verify health, model discovery &amp; first inference call
                </h2>
                <span className="font-mono text-[10.5px] text-faint">Client verification</span>
              </div>
              <CodeBlock code={verifyCmd} lang="bash" path="Verification commands" showLineNumbers={false} />
            </li>
          </ol>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 font-mono text-[11px]">
            <div className="flex flex-wrap gap-4">
              <a href={REPO_LINKS.dockerDoc} target="_blank" rel="noreferrer noopener" className="text-amber hover:underline">
                Docker Deployment Doc ↗
              </a>
              <a href={REPO_LINKS.lanHubDoc} target="_blank" rel="noreferrer noopener" className="text-amber hover:underline">
                LAN Hub Guide ↗
              </a>
              <a href={REPO_LINKS.ollamaDoc} target="_blank" rel="noreferrer noopener" className="text-amber hover:underline">
                Ollama Integration Guide ↗
              </a>
            </div>
            <RouteLink to="/security" className="text-rust hover:underline">
              Review Security Boundaries Before LAN Exposure →
            </RouteLink>
          </div>
        </Container>
      </section>
      )}
    </div>
  );
}
