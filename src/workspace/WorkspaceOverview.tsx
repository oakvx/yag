import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Braces, Check, ChevronRight, CircleAlert, Copy, Network, Terminal } from "lucide-react";
import { RouteLink } from "@/router/RouterContext";
import { GatewayDiagram } from "./GatewayDiagram";

const PROTOCOLS = [
  { label: "Chat Completions", endpoint: "/v1/chat/completions", status: "Transparent passthrough", description: "Your request, forwarded as-is. Streaming and tool-call structures stay intact.", body: '{"model":"llama3.2","messages":[{"role":"user","content":"Hello, YAG."}]}' },
  { label: "Responses", endpoint: "/v1/responses", status: "Stateless adapter", description: "A bounded Responses subset, translated to Chat Completions. Real-model compatibility is unverified.", body: '{"model":"llama3.2","input":"Hello, YAG.","store":false}' },
  { label: "Anthropic Messages", endpoint: "/v1/messages", status: "Messages adapter", description: "A bounded Messages subset with text and function tools. Real-model compatibility is unverified.", body: '{"model":"llama3.2","max_tokens":256,"messages":[{"role":"user","content":"Hello, YAG."}]}' },
];

function HighlightedCode({ code }: { code: string }) {
  return <code>{code.split("\n").map((line, lineIndex) => <span className="snippet-line" key={lineIndex}><span className="snippet-line-number" aria-hidden="true">{String(lineIndex + 1).padStart(2, "0")}</span><span>{line.split(/("[^"\n]*"|'[^'\n]*'|\b(?:curl|import|print|requests|os)\b)/g).map((token, tokenIndex) => <span key={tokenIndex} className={/^["']/.test(token) ? "snippet-string" : /^(curl|import|print|requests|os)$/.test(token) ? "snippet-keyword" : undefined}>{token}</span>)}{"\n"}</span></span>)}</code>;
}

export function WorkspaceOverview() {
  const [selected, setSelected] = useState(0);
  const [language, setLanguage] = useState("curl");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snippet = useRef<HTMLPreElement>(null);
  const protocol = PROTOCOLS[selected];
  const body = JSON.stringify(JSON.parse(protocol.body), null, 2);
  const command = language === "curl"
    ? `curl http://127.0.0.1:8080${protocol.endpoint} \\\n  -H "Authorization: Bearer $YAG_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`
    : `import os, requests\n\nresponse = requests.post(\n    "http://127.0.0.1:8080${protocol.endpoint}",\n    headers={"Authorization": f"Bearer {os.environ['YAG_API_KEY']}"},\n    json=${protocol.body.replace(/false/g, "False")},\n)\nprint(response.json())`;

  useEffect(() => { setCopyState("idle"); }, [selected, language]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const copy = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
    } catch {
      const selection = window.getSelection();
      if (selection && snippet.current) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(snippet.current);
        selection.addRange(range);
      }
      setCopyState("error");
    }
    copyTimer.current = setTimeout(() => setCopyState("idle"), 2500);
  };

  return <>
    <section className="overview-hero" aria-labelledby="overview-title">
      <div className="hero-copy">
        <p className="hero-eyebrow"><span />YET ANOTHER GATEWAY</p>
        <h1 id="overview-title"><span className="hero-wordmark">YAG<span>.</span></span><span className="hero-headline">Your models.<br /><span>One gateway.</span></span></h1>
        <p className="hero-description">One native binary between your apps and your AI.<br className="desktop-break" /> Authentication, routing, and protocols. Handled.</p>
        <div className="hero-actions">
          <RouteLink to="/architecture" className="workspace-button primary">Explore the gateway <ArrowRight size={16} /></RouteLink>
          <RouteLink to="/deploy?view=quickstart" className="workspace-button secondary"><Terminal size={15} />Quickstart</RouteLink>
        </div>
        <p className="hero-footnote">Self-hosted. Open source. Yours to run.</p>
      </div>
      <GatewayDiagram selected={selected} onSelect={setSelected} />
    </section>

    <section className="explore-section" aria-labelledby="explore-title">
      <div className="workspace-section-heading"><div><h2 id="explore-title">A little understanding goes a long way.</h2><p>Get to know the gateway, one layer at a time.</p></div><RouteLink to="/source" className="subtle-link">Browse the source <ArrowUpRight size={14} /></RouteLink></div>
      <div className="explore-grid">
        {[
          { to: "/architecture", icon: Network, number: "01", title: "See the big picture", description: "From your first request to your upstream. Explore how everything connects.", label: "Architecture" },
          { to: "/protocols", icon: Braces, number: "02", title: "Speak every protocol", description: "Chat, Responses, and Messages. See what passes through and what gets translated.", label: "Protocol explorer" },
          { to: "/deploy", icon: Terminal, number: "03", title: "Make it your own", description: "Build the host, connect an upstream, and send your first request.", label: "Build & deploy" },
        ].map(({ to, icon: Icon, number, title, description, label }) => <RouteLink to={to} key={to} className="explore-card">
          <div className="explore-card-top"><Icon size={21} strokeWidth={1.5} /><span>{number}<ArrowUpRight size={15} /></span></div>
          <h3>{title}</h3><p>{description}</p><span className="explore-card-link">{label}<ArrowRight size={13} /></span>
        </RouteLink>)}
      </div>
    </section>

    <section className="integration-section" aria-labelledby="integration-title">
      <div className="workspace-section-heading"><div><h2 id="integration-title">Different protocols. Same front door.</h2><p>Keep the tools you love. Point them at YAG.</p></div><RouteLink to="/protocols" className="subtle-link">Explore all protocols <ArrowUpRight size={14} /></RouteLink></div>
      <div className="integration-workbench">
        <div className="integration-tabs" role="tablist" aria-label="Request protocol">
          {PROTOCOLS.map((item, index) => <button key={item.endpoint} role="tab" id={`protocol-tab-${index}`} aria-controls="protocol-example" aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (selected + 1) % 3 : event.key === "ArrowLeft" ? (selected + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
            if (next === null) return;
            event.preventDefault(); setSelected(next); document.getElementById(`protocol-tab-${next}`)?.focus();
          }}>{index === 0 ? <Network size={14} /> : index === 1 ? <Terminal size={14} /> : <Braces size={14} />}<span>{item.label}</span></button>)}
          <span className="integration-tab-label">REQUEST EXAMPLES</span>
        </div>
        <div className="integration-content" id="protocol-example" role="tabpanel" aria-labelledby={`protocol-tab-${selected}`} tabIndex={0}>
          <div className="integration-code">
            <div className="snippet-toolbar"><div><span className="snippet-method">POST</span><span className="snippet-endpoint">{protocol.endpoint}</span></div><div><label className="sr-only" htmlFor="snippet-language">Example language</label><select id="snippet-language" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="curl">cURL</option><option value="python">Python</option></select><button className="snippet-copy" onClick={copy} aria-label={copyState === "copied" ? "Code copied" : "Copy request example"}>{copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}<span>{copyState === "copied" ? "Copied" : copyState === "error" ? "Text selected" : "Copy"}</span></button></div></div>
            <pre ref={snippet} className="request-snippet"><HighlightedCode code={command} /></pre>
            <span className="sr-only" role="status">{copyState === "copied" ? "Request example copied to clipboard." : copyState === "error" ? "Clipboard unavailable. The code is selected; use your keyboard to copy it." : ""}</span>
          </div>
          <aside className="protocol-explanation" aria-live="polite"><div className="protocol-mode"><span />{protocol.status}</div><h3>A familiar request.<br />A simpler route.</h3><p>{protocol.description}</p><p className="example-note">Example only. Start your host and set your gateway key before running.</p><RouteLink to="/lifecycle">Trace a request <ArrowRight size={14} /></RouteLink></aside>
        </div>
        <div className="workbench-footer"><span><ShieldIcon />Upstream credentials never leave your host.</span><RouteLink to="/security">See the boundaries <ChevronRight size={13} /></RouteLink></div>
      </div>
      <div className="experimental-note"><CircleAlert size={15} /><p><strong>A foundation, not a fortress.</strong> YAG is experimental. Real-model compatibility remains unverified.</p><RouteLink to="/status">Project status <ArrowUpRight size={13} /></RouteLink></div>
    </section>
  </>;
}

function ShieldIcon() {
  return <svg width="13" height="14" viewBox="0 0 16 17" fill="none" aria-hidden="true"><path d="m8 1 6 2.5V8c0 3.6-6 7-6 7S2 11.6 2 8V3.5L8 1Z" stroke="currentColor" strokeWidth="1.2" /><path d="m5.5 7.5 1.7 1.7L11 5.5" stroke="currentColor" strokeWidth="1.2" /></svg>;
}