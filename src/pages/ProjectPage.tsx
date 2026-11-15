import { XmbRow } from "@/components/XmbRow";
import { XmbScreen } from "@/components/XmbScreen";
import { REPO_LINKS, TREE_URL } from "@/data/repository";
import { useRouter } from "@/router/RouterContext";

const REPO_LAYOUT = [
  { dir: "desktop/", desc: "Optional native chat client for Windows, macOS and Linux; connects to remote YAG hosts." },
  { dir: "host/", desc: "C17 listener, constant-time auth, exact-model routing, scheduler and protocol adapters." },
  { dir: "console/", desc: "Optional React + TypeScript browser UI served statically by the host." },
  { dir: "tests/", desc: "Python contract suites for framing, fuzzing, rate limits, fallback and the mock adapters." },
  { dir: "docs/", desc: "Architecture status, Docker and LAN deployment guides, Codex / Claude Code probe notes." },
  { dir: "scripts/", desc: "Cross-platform Colibri LAN hub manager (lan.py) for private-CA HTTPS setups." },
  { dir: "third_party/yyjson/", desc: "Vendored yyjson 0.12.0 with its original MIT license." },
];

const CONTRIBUTIONS = [
  {
    topic: "Real-model probes",
    title: "Qualify real inference backends",
    body: "Run the isolated probes described in docs/integrations/live-model.md and real-model.md against Ollama, vLLM or llama.cpp, and record exact model IDs and failure modes.",
    href: REPO_LINKS.liveModelDoc,
    link: "Read live-model.md",
  },
  {
    topic: "Protocol diagnostics",
    title: "Report adapter mismatches safely",
    body: "When a Responses or Anthropic client hits a 400 rejection, YAG_TRACE_ANTHROPIC_SHAPE=1 logs allow-listed field and block categories — never prompt text or secrets.",
    href: REPO_LINKS.newIssue,
    link: "Open an issue on GitHub",
  },
  {
    topic: "Host hardening",
    title: "Review HTTP framing and edge cases",
    body: "Inspect socket deadline edge cases and C17 buffer invariants, and extend the byte-level malformed-input corpus in tests/http_fuzz.py.",
    href: `${REPO_LINKS.repo}/blob/main/tests/http_fuzz.py`,
    link: "Inspect tests/http_fuzz.py",
  },
];

export function ProjectPage() {
  const { query } = useRouter();
  return <XmbScreen document={<p>YAG is a small, experimental C17 gateway released under the MIT License. It handles routing, translation and admission. It never runs a model or executes a tool. The repository, implementation scope and contribution guides follow.</p>} key={query.view ?? "about"} initialSection={query.view === "contributing" ? 2 : undefined}
    subtitle="An experimental C17 gateway, released under the MIT License." sections={[
    { id: "about", label: "About", entries: [
      { key: "repo", title: "Repository", value: "oakvx/yag", href: REPO_LINKS.repo },
      { key: "license", title: "License", value: "MIT", href: REPO_LINKS.license },
      { key: "stage", title: "Release stage", value: "Experimental · reviewed candidate workflow", description: "Host and Desktop packaging includes checksums and signed build provenance. Packaging does not qualify real models or establish production security." },
      { key: "scope", title: "Scope", value: "Routing, translation, admission", description: "YAG never runs a model or executes a tool." },
      { key: "status", title: "Qualification ledger", to: "/status" },
      { key: "profile", title: "Maintainer profile", to: "/profile" },
    ], panel: <p>“It never runs a model and never executes a tool — and never will. That’s not a limitation. That’s the scope.” YAG is an engineering foundation for developers who prefer small, inspectable C code and explicit operational boundaries.</p> },
    { id: "layout", label: "Repository anatomy", entries: REPO_LAYOUT.map((item) => ({
      key: item.dir, title: item.dir, description: item.desc, panel: <p>{item.desc}</p>,
      href: `${TREE_URL}/${item.dir.replace(/\/$/, "")}`,
    })) },
    { id: "contributing", label: "Contributing", entries: CONTRIBUTIONS.map((item) => ({
      key: item.topic, title: item.topic, description: item.title,
      panel: <><p>{item.title}</p><p>{item.body}</p><XmbRow href={item.href}>{item.link}</XmbRow></>,
    })), panel: <p>Automated tests use a deterministic mock backend. Reproducible observations against real inference engines are the most useful contribution.</p> },
  ]} />;
}
