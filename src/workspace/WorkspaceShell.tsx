import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity, ArrowUpRight, Bell, BookOpen, Box, Braces, ChevronRight,
  Code2, Command, Gamepad2, GitBranch, GitCommitHorizontal,
  LayoutGrid, Menu, Network, Search, Settings2, ShieldCheck, SlidersHorizontal,
  Terminal, Waypoints, X, type LucideIcon,
} from "lucide-react";
import { RouteLink, useRouter } from "@/router/RouterContext";
import { REPO_LINKS } from "@/data/repository";
import { COMMIT_NOTICES } from "@/data/commits.generated";
import { QuickJump } from "@/xmb/QuickJump";
import { publicAsset } from "@/xmb/assets";
import { useBrandFont } from "@/xmb/brandFont";
import { usePrefersReducedMotion } from "@/hooks/useInView";
import { BrandSymbol, GithubMark } from "./Brand";
import { useWorkspacePreferences } from "./preferences";
import "./workspace.css";

const NAVIGATION: Array<{ label: string; items: Array<{ label: string; to: string; icon: LucideIcon }> }> = [
  { label: "WORKSPACE", items: [
    { label: "Overview", to: "/", icon: LayoutGrid },
    { label: "Architecture", to: "/architecture", icon: Network },
    { label: "Request lifecycle", to: "/lifecycle", icon: Waypoints },
    { label: "Protocol explorer", to: "/protocols", icon: Braces },
    { label: "Model routing", to: "/routing", icon: GitBranch },
  ] },
  { label: "DEVELOP", items: [
    { label: "Source explorer", to: "/source", icon: Code2 },
    { label: "Deployment", to: "/deploy", icon: Terminal },
    { label: "Configuration", to: "/deploy?view=configuration", icon: SlidersHorizontal },
  ] },
  { label: "PROJECT", items: [
    { label: "Security", to: "/security", icon: ShieldCheck },
    { label: "Project status", to: "/status", icon: Activity },
    { label: "About YAG", to: "/project", icon: Box },
  ] },
];

export function WorkspaceShell({ children, onConsole }: { children: ReactNode; onConsole: () => void }) {
  const { path, query, route, phase, paletteOpen, setPaletteOpen } = useRouter();
  const brandFont = useBrandFont();
  const { accent, motion } = useWorkspacePreferences();
  const reducedMotion = usePrefersReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const activityButton = useRef<HTMLButtonElement>(null);
  const currentView = query.view ?? "";
  const previousLocation = useRef(path + currentView);
  const isHome = path === "/" && !currentView;
  const pageTitle = isHome ? "Overview" : currentView === "configuration" ? "Configuration"
    : currentView === "operations" ? "Operations" : currentView === "system" ? "System information"
    : currentView === "quickstart" ? "Quickstart" : path === "/theme" ? "Display settings" : route.shortLabel;
  const utilityDescription = currentView === "configuration" ? "A reference for your host environment. Static settings take effect after restarting YAG."
    : currentView === "operations" ? "Know where to check host health and provider state. Documentation, not a connection to your gateway."
    : currentView === "system" ? "Specifications from the repository. These describe the software, not a running server."
    : path === "/trophies" ? "Your collection from the console. Progress is stored only in this browser." : null;

  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
    setMenuOpen(false);
    setActivityOpen(false);
    if (previousLocation.current !== path + currentView) {
      previousLocation.current = path + currentView;
      const origin = document.activeElement;
      if (origin && main.current?.contains(origin)) return;
      const frame = requestAnimationFrame(() => {
        if (document.activeElement === origin || document.activeElement === document.body) {
          main.current?.focus({ preventScroll: true });
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [path, currentView]);

  useEffect(() => {
    if (menuOpen) sidebar.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!isHome) return;
    // The router writes its console title after the initial child effects.
    const frame = requestAnimationFrame(() => {
      document.title = "Workspace View | YAG — Yet Another Gateway";
    });
    return () => cancelAnimationFrame(frame);
  }, [isHome, phase]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
      if (activityOpen) { setActivityOpen(false); activityButton.current?.focus(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [menuOpen, activityOpen]);

  const activeLink = (to: string) => {
    const [linkPath, search] = to.split("?");
    const linkView = new URLSearchParams(search).get("view") ?? "";
    if (to === "/deploy" && currentView === "quickstart") return path === "/deploy";
    return linkPath === path && linkView === currentView;
  };

  return <div className="workspace" data-accent={accent} data-motion={motion && !reducedMotion ? "on" : "off"}>
    <a className="workspace-skip" href="#main-content">Skip to content</a>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }} />}
    <aside ref={sidebar} className={`workspace-sidebar ${menuOpen ? "is-open" : ""}`} aria-label="Workspace navigation"
      onKeyDown={(event) => {
        if (!menuOpen || event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("a[href], button")];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="sidebar-brand-row">
        <RouteLink to="/" className="sidebar-brand" aria-label="YAG overview">
          <BrandSymbol /><span style={brandFont ? { fontFamily: brandFont } : undefined}>YAG<span className="logo-dot">.</span></span>
        </RouteLink>
        <span className="sidebar-version">v0.1</span>
        <button className="sidebar-close icon-button" aria-label="Close menu" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }}><X size={19} /></button>
      </div>
      <button className="workspace-search" onClick={() => { setPaletteOpen(true); setMenuOpen(false); }}>
        <Search size={15} /><span>Search anything</span><kbd><Command size={10} /> K</kbd>
      </button>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {NAVIGATION.map((group) => <div className="nav-group" key={group.label}>
          <p className="nav-group-label">{group.label}</p>
          {group.items.map(({ label, to, icon: Icon }) => <RouteLink
            to={to} key={to} className={`sidebar-link ${activeLink(to) ? "is-active" : ""}`}
            aria-current={activeLink(to) ? "page" : undefined}
            onAfterNavigate={() => setMenuOpen(false)}>
            <Icon size={16} strokeWidth={1.6} /><span>{label}</span>
            {activeLink(to) && <span className="nav-active-dot" />}
          </RouteLink>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <RouteLink to="/theme" className={`sidebar-link ${path === "/theme" ? "is-active" : ""}`} aria-current={path === "/theme" ? "page" : undefined}><Settings2 size={16} strokeWidth={1.6} />Display settings</RouteLink>
        <button className="sidebar-link console-mode-link" onClick={onConsole}><Gamepad2 size={17} strokeWidth={1.6} /><span>Return to console</span><ArrowUpRight size={13} /></button>
        <div className="sidebar-project">
          <div className="maintainer-avatar"><BrandSymbol /></div>
          <div><p>Built in the open</p><a href={REPO_LINKS.author} target="_blank" rel="noreferrer">by oakvx <ArrowUpRight size={11} /></a></div>
          <a className="project-github" href={REPO_LINKS.repo} target="_blank" rel="noreferrer" aria-label="YAG on GitHub"><GithubMark size={17} /></a>
        </div>
      </div>
    </aside>

    <div className="workspace-body" inert={menuOpen ? true : undefined}>
      <header className="workspace-topbar">
        <button ref={menuButton} className="mobile-menu-button icon-button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
        <div className="workspace-breadcrumb"><span>Workspace</span><ChevronRight size={13} /><span aria-current="page">{pageTitle}</span></div>
        <div className="topbar-actions">
          <span className="experimental-label"><span />Experimental</span>
          <span className="topbar-divider" />
          <a className="docs-link" href={REPO_LINKS.readme} target="_blank" rel="noreferrer"><BookOpen size={15} /><span>Documentation</span><ArrowUpRight size={12} /></a>
          <button ref={activityButton} className={`icon-button activity-button ${activityOpen ? "is-active" : ""}`} onClick={() => setActivityOpen(!activityOpen)} aria-label="Repository activity" aria-expanded={activityOpen}><Bell size={17} /><span /></button>
        </div>
      </header>

      {activityOpen && <>
        <button className="activity-backdrop" aria-label="Close repository activity" onClick={() => setActivityOpen(false)} />
        <aside className="activity-popover" aria-label="Repository activity">
          <div className="activity-heading"><div><h2>From the repository</h2><p>Updates from the bundled source snapshot.</p></div><button className="icon-button" aria-label="Close updates" onClick={() => setActivityOpen(false)}><X size={17} /></button></div>
          {COMMIT_NOTICES.slice(0, 4).map((commit) => <a href={`${REPO_LINKS.repo}/commit/${commit.sha}`} key={commit.sha} target="_blank" rel="noreferrer" className="activity-entry">
            <GitCommitHorizontal size={17} /><div><p>{commit.subject}</p><span>{commit.short} <span className="activity-date">{new Date(commit.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></span></div><ArrowUpRight size={12} />
          </a>)}
          <a href={`${REPO_LINKS.repo}/commits/main`} className="activity-all" target="_blank" rel="noreferrer">All commits on GitHub <ArrowUpRight size={13} /></a>
        </aside>
      </>}

      <main ref={main} id="main-content" tabIndex={-1} className="workspace-main">
        <div className={`workspace-route ${isHome ? "overview-route" : "tool-route"}`} data-phase={phase}>
          {!isHome && <div className="tool-page-label"><span>{path === "/theme" ? "PERSONALIZE YOUR WORKSPACE" : "YAG / " + pageTitle.toUpperCase()}</span><RouteLink to="/" className="tool-back">Back to overview <ChevronRight size={13} /></RouteLink></div>}
          <div className={isHome ? "" : "workspace-tool"}>{utilityDescription && <header className="utility-page-heading"><h1>{pageTitle}</h1><p>{utilityDescription}</p></header>}{children}</div>
          <footer className="workspace-footer"><span><BrandSymbol />Small by design. Open by default.</span><div><a href={publicAsset("LICENSE.txt")} target="_blank" rel="noreferrer">MIT license</a><a href={REPO_LINKS.repo} target="_blank" rel="noreferrer">View on GitHub <ArrowUpRight size={12} /></a></div></footer>
        </div>
      </main>
    </div>
    {paletteOpen && <QuickJump workspace />}
  </div>;
}
