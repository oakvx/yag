import type { KeyboardEvent } from "react";
import { useRouter } from "@/router/RouterContext";

const INPUTS = [
  { name: "OpenAI", sub: "Chat Completions", y: 76, path: "M158 100 H188 Q199 100 207 108 L261 162" },
  { name: "Responses", sub: "OpenAI / Codex", y: 171, path: "M158 195 H261" },
  { name: "Anthropic", sub: "Messages API", y: 266, path: "M158 290 H188 Q199 290 207 282 L261 228" },
];

const OUTPUTS = [
  { name: "Ollama", sub: "Local inference", y: 91, path: "M456 173 L496 150 Q506 144 506 132 V117 Q506 109 514 104 L540 89" },
  { name: "vLLM", sub: "Model serving", y: 190, path: "M456 201 H505 Q513 201 520 197 L540 185" },
  { name: "llama.cpp", sub: "Your hardware", y: 293, path: "M456 227 L492 247 Q500 251 500 260 V267 Q500 275 508 280 L540 298" },
];

function activateWithKeyboard(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
}

export function GatewayDiagram({ selected, onSelect }: { selected: number; onSelect: (index: number) => void }) {
  const { navigate } = useRouter();

  return <figure className="gateway-figure">
    <svg className="gateway-diagram" viewBox="0 0 680 395" aria-label="Interactive architecture: three client protocols connect through YAG to your inference servers">
      <defs>
        <radialGradient id="gateway-halo"><stop offset="0" stopColor="var(--accent)" stopOpacity=".13" /><stop offset=".58" stopColor="var(--accent)" stopOpacity=".035" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
        <linearGradient id="chip-top" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#304b3d" /><stop offset=".47" stopColor="#1b3026" /><stop offset="1" stopColor="#254232" /></linearGradient>
        <linearGradient id="chip-left" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#1e3529" /><stop offset="1" stopColor="#101e17" /></linearGradient>
        <linearGradient id="chip-right" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#233d2e" /><stop offset="1" stopColor="#15281d" /></linearGradient>
        <linearGradient id="chip-edge"><stop stopColor="var(--accent)" stopOpacity=".2" /><stop offset=".5" stopColor="var(--accent)" stopOpacity=".85" /><stop offset="1" stopColor="var(--accent)" stopOpacity=".3" /></linearGradient>
        <linearGradient id="client-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#1b2420" /><stop offset="1" stopColor="#151b18" /></linearGradient>
        <pattern id="isometric-grid" width="84" height="48" patternUnits="userSpaceOnUse"><path d="m0 24 42-24 42 24-42 24Z" fill="none" stroke="var(--accent)" strokeWidth=".55" /></pattern>
        <radialGradient id="grid-fade"><stop stopColor="white" stopOpacity=".8" /><stop offset="1" stopColor="white" stopOpacity="0" /></radialGradient>
        <mask id="grid-mask"><rect width="680" height="395" fill="url(#grid-fade)" /></mask>
        <filter id="packet-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.8" /></filter>
        <filter id="chip-shadow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#000" floodOpacity=".55" /></filter>
      </defs>

      <rect width="680" height="395" fill="url(#isometric-grid)" mask="url(#grid-mask)" opacity=".13" />
      <ellipse cx="359" cy="206" rx="260" ry="187" fill="url(#gateway-halo)" />
      <g className="diagram-column-labels"><text x="19" y="44">CLIENTS</text><text x="358" y="44" textAnchor="middle">ONE LOCAL ENDPOINT</text><text x="544" y="44">YOUR UPSTREAMS</text></g>

      <path d="m213 261 145-84 145 84-145 84Z" stroke="var(--accent)" strokeOpacity=".12" strokeDasharray="3 6" fill="none" />
      <path d="m239 262 119-69 119 69-119 69Z" stroke="var(--accent)" strokeOpacity=".07" fill="var(--accent)" fillOpacity=".025" />

      {INPUTS.map((input, index) => <g key={input.name}>
        <path d={input.path} className={`diagram-wire ${selected === index ? "is-active" : ""}`} />
        {selected === index && <><path d={input.path} className="diagram-packet packet-glow" filter="url(#packet-glow)" /><path d={input.path} className="diagram-packet" /></>}
        <circle cx="158" cy={input.y + 24} r="2.3" fill={selected === index ? "var(--accent)" : "#425349"} />
      </g>)}

      {OUTPUTS.map((output, index) => <g key={output.name}>
        <path d={output.path} className={`diagram-wire output-wire ${index === 0 ? "is-active" : ""}`} />
        {index === 0 && <><path d={output.path} className="diagram-packet output-packet packet-glow" filter="url(#packet-glow)" /><path d={output.path} className="diagram-packet output-packet" /></>}
      </g>)}

      <g className="gateway-base">
        <path d="m247 251 111-64 111 64-111 65Z" fill="#16221a" stroke="#344c3c" strokeWidth=".8" />
        <path d="m247 251 111 65v13l-111-64Z" fill="#121c15" stroke="#2b4032" strokeWidth=".8" />
        <path d="m358 316 111-65v14l-111 64Z" fill="#17271d" stroke="#3c5945" strokeWidth=".8" />
        <path d="m258 251 100 58 100-58" fill="none" stroke="var(--accent)" strokeOpacity=".38" />
        <path d="m287 269 71 41 71-41" fill="none" stroke="var(--accent)" strokeOpacity=".2" filter="url(#packet-glow)" strokeWidth="5" />
      </g>

      <g className="gateway-chip diagram-interactive" role="link" tabIndex={0} aria-label="Explore YAG architecture" onClick={() => navigate("/architecture")} onKeyDown={(event) => activateWithKeyboard(event, () => navigate("/architecture"))}>
        <g filter="url(#chip-shadow)">
          <path d="m260 173 98-57 98 57-98 57Z" fill="url(#chip-top)" stroke="url(#chip-edge)" strokeWidth="1.1" />
          <path d="m260 173 98 57v53l-98-57Z" fill="url(#chip-left)" stroke="#587660" strokeWidth=".8" />
          <path d="m358 230 98-57v53l-98 57Z" fill="url(#chip-right)" stroke="#668b6d" strokeWidth=".8" />
          <path d="m274 173 84-49 84 49-84 49Z" fill="none" stroke="var(--accent)" strokeOpacity=".18" strokeWidth=".7" />
          <path d="m283 173 75-44 75 44-75 44Z" fill="none" stroke="var(--accent)" strokeOpacity=".08" strokeWidth=".7" />
          <path d="m260 217 98 57 98-57" fill="none" stroke="var(--accent)" strokeOpacity=".16" strokeWidth=".7" />
          <path d="m260 226 98 57 98-57" fill="none" stroke="var(--accent)" strokeOpacity=".46" strokeWidth="1.4" />
          <text className="chip-wordmark" textAnchor="middle" transform="matrix(.866 .5 -.866 .5 358 176)" y="12">YAG</text>
          <text className="chip-detail" transform="matrix(.866 .5 0 1 273 202)">NATIVE GATEWAY</text>
          <g fill="var(--accent)"><circle cx="421" cy="232" r="1.5" /><circle cx="429" cy="227.4" r="1.5" opacity=".55" /><circle cx="437" cy="222.8" r="1.5" opacity=".28" /></g>
          <path d="M272 216v6m6-2.5v6m6-2.5v6m6-2.5v6m6-2.5v6" stroke="var(--accent)" strokeOpacity=".3" strokeWidth="1.2" />
          <path d="m260 173 98 57 98-57" fill="none" stroke="var(--accent)" strokeOpacity=".7" strokeWidth="1" />
        </g>
      </g>

      {INPUTS.map((input, index) => <g key={input.name} className={`diagram-client diagram-interactive ${selected === index ? "is-active" : ""}`} role="button" tabIndex={0} aria-pressed={selected === index} aria-label={`Inspect ${input.name} protocol`} onClick={() => onSelect(index)} onKeyDown={(event) => activateWithKeyboard(event, () => onSelect(index))}>
        <rect className="client-box" x="17" y={input.y} width="141" height="48" rx="6" fill="url(#client-fill)" />
        <g transform={`translate(29 ${input.y + 16})`} className="client-icon" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          {index === 0 ? <><path d="m8 0 7 4v8l-7 4-7-4V4Z" /><path d="m1 4 7 4 7-4M8 8v8M4.5 2 12 6v8" /></> : index === 1 ? <><path d="m1 3 5 5-5 5M9 13h6" /><path d="M10 1h5v5" /></> : <><path d="m1 15 5-14 5 14M3 10h6M12 1l4 14" /></>}
        </g>
        <text x="56" y={input.y + 20} className="client-name">{input.name}</text>
        <text x="56" y={input.y + 34} className="client-sub">{input.sub}</text>
      </g>)}

      {OUTPUTS.map((output, index) => <g key={output.name} className={`diagram-server diagram-interactive ${index === 0 ? "is-active" : ""}`} role="link" tabIndex={0} aria-label={`Explore model routing for ${output.name}`} onClick={() => navigate("/routing")} onKeyDown={(event) => activateWithKeyboard(event, () => navigate("/routing"))}>
        <g transform={`translate(538 ${output.y - 12})`} fill="none" stroke="currentColor" strokeWidth=".85" strokeLinejoin="round">
          <path d="m0 0 17-10L34 0 17 10Z" fill="#18251d" />
          <path d="m0 0 17 10v29L0 29Z" fill="#111b15" /><path d="m17 10 17-10v29L17 39Z" fill="#1a2c20" />
          <path d="m0 10 17 10 17-10M0 20l17 10 17-10" />
          <path d="m22 16 7-4m-7 14 7-4m-7 14 7-4" strokeOpacity=".7" />
          <circle cx="6" cy="12" r="1" fill="currentColor" /><circle cx="6" cy="22" r="1" fill="currentColor" />
        </g>
        <text x="587" y={output.y + 2} className="server-name">{output.name}</text>
        <text x="587" y={output.y + 17} className="server-sub">{output.sub}</text>
      </g>)}
      <path d="M358 333v15" stroke="var(--accent)" strokeOpacity=".25" />
      <text x="358" y="365" textAnchor="middle" className="diagram-address">127.0.0.1:8080</text>
    </svg>
    <figcaption><span><span className="diagram-caption-dot" />A single point of connection.</span><span>Interactive schematic <span className="diagram-hint">/ not live traffic</span></span></figcaption>
  </figure>;
}