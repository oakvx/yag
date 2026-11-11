import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import { Activity, ArrowDownLeft, ArrowUpRight, Box, Braces, Check, ChevronDown, CircleHelp, Clipboard, Clock3, Code2, Cpu, ExternalLink, KeyRound, Layers3, LayoutDashboard, LockKeyhole, Menu, MessageSquare, RefreshCw, Send, Server, Settings2, ShieldCheck, Square, Terminal, X } from 'lucide-react'
import './styles.css'

type Page = 'Overview' | 'Playground' | 'Models' | 'Integrations' | 'Requests' | 'Settings'
type Model = { id: string; owned_by?: string }
type Route = { model: string; circuit_open?: boolean; consecutive_connect_failures?: number }
type ModelCapability = { model:string; declared:boolean; capabilities: { tools:boolean|null; streaming:boolean|null; vision:boolean|null; reasoning:boolean|null; max_context_tokens:number|null } }
type Status = { status: string; uptime_seconds: number; active_connections: number; total_connections: number }
type Metrics = { chat_requests:number; responses_requests:number; anthropic_requests:number; model_list_requests:number; provider_check_requests:number; upstream_attempts:number; upstream_successes:number; upstream_http_errors:number; upstream_transport_failures:number; upstream_total_latency_ms:number; circuit_rejections:number }
type Message = { role: 'user' | 'assistant'; content: string }
const navigation: { title: string; items: { name: Page; icon: typeof Activity }[] }[] = [
  { title: 'WORKSPACE', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Playground', icon: MessageSquare }, { name: 'Models', icon: Box }] },
  { title: 'GATEWAY', items: [{ name: 'Integrations', icon: Braces }, { name: 'Requests', icon: Activity }, { name: 'Settings', icon: Settings2 }] },
]
const api = async (path: string, key: string, options: RequestInit = {}) => {
  const res = await fetch(path, { ...options, headers: { Authorization: `Bearer ${key}`, ...options.headers } })
  if (!res.ok) { let message = `Request failed (${res.status})`; try { const data = await res.json(); message = data.error?.message || message } catch { /* upstream may return non-JSON */ } throw new Error(message) }
  return res
}
function formatUptime(seconds: number) { const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60); return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m` }
function App() {
  const [page, setPage] = useState<Page>('Overview')
  const [key, setKey] = useState(() => sessionStorage.getItem('yag_key') || '')
  const [keyDraft, setKeyDraft] = useState(key)
  const [status, setStatus] = useState<Status | null>(null)
  const [metrics,setMetrics]=useState<Metrics|null>(null)
  const [metricsError,setMetricsError]=useState('')
  const [models, setModels] = useState<Model[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [capabilities,setCapabilities]=useState<ModelCapability[]>([])
  const [routeError, setRouteError] = useState('')
  const [error, setError] = useState('')
  const [modelError, setModelError] = useState('')
  const [model, setModel] = useState('')
  const [mobile, setMobile] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const refresh = useCallback(async () => {
    if (!key) { setStatus(null); setMetrics(null); setModels([]); setRoutes([]); setCapabilities([]); setError(''); setModelError(''); setRouteError(''); setMetricsError(''); return }
    try { const response = await api('/api/status', key); setStatus(await response.json()); setError(''); setLastUpdated(new Date()) } catch (e) { setStatus(null); setError((e as Error).message) }
    try { const response = await api('/v1/models', key); const data = await response.json(); if (!Array.isArray(data.data)) throw new Error('Backend returned an invalid model list'); setModels(data.data.filter((m: Model) => typeof m.id === 'string')); setModelError('') } catch (e) { setModels([]); setModelError((e as Error).message) }
    try { const response = await api('/api/routes', key); const data = await response.json(); if (!Array.isArray(data.data)) throw new Error('Invalid route registry'); setRoutes(data.data.filter((route: Route) => typeof route.model === 'string')); setRouteError('') } catch (e) { setRoutes([]); setRouteError((e as Error).message) }
    try { const response = await api('/api/model-capabilities',key); const data=await response.json(); setCapabilities(Array.isArray(data.data)?data.data:[]) } catch {setCapabilities([])}
    try { const response = await api('/api/metrics',key); setMetrics(await response.json()); setMetricsError('') } catch(e) {setMetrics(null);setMetricsError((e as Error).message)}
  }, [key])
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 30000); return () => clearInterval(timer) }, [refresh])
  const selectableModels: Model[] = [...models, ...routes.filter(r => !models.some(m => m.id === r.model)).map(r => ({ id: r.model, owned_by: 'Configured route' }))]
  useEffect(() => { if (selectableModels.length && !selectableModels.some(m => m.id === model)) setModel(selectableModels[0].id); if (!selectableModels.length) setModel('') }, [models, routes, model])
  const saveKey = (event: React.FormEvent) => { event.preventDefault(); const trimmed = keyDraft.trim(); if (trimmed) sessionStorage.setItem('yag_key', trimmed); else sessionStorage.removeItem('yag_key'); setKey(trimmed) }
  const go = (p: Page) => { setPage(p); setMobile(false) }
  return <div className="app-shell">
    <aside className={`sidebar ${mobile ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><span></span><span></span><span></span></div><div><b>YAG</b><small>YET ANOTHER GATEWAY</small></div><button className="mobile-close icon-button" onClick={() => setMobile(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <div className="workspace"><div className="workspace-icon"><Server size={16}/></div><div><b>YAG Host</b><small>Self-hosted gateway</small></div><ChevronDown size={14} className="muted"/></div>
      <nav>{navigation.map(group => <div className="nav-group" key={group.title}><div className="nav-label">{group.title}</div>{group.items.map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${page === name ? 'selected' : ''}`} onClick={() => go(name)}><Icon size={16}/><span>{name}</span>{page === name && <span className="nav-indicator"/>}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="side-status"><span className={`status-dot ${status ? 'on' : ''}`}></span><div><b>{status ? 'Host connected' : 'Not connected'}</b><small>{status ? 'Gateway is responding' : 'Enter an API key to connect'}</small></div></div><div className="side-version"><span>YAG HOST</span><span>EARLY ACCESS · 0.1</span></div></div>
    </aside>
    <main className="main"><header className="topbar"><button className="menu-button icon-button" onClick={() => setMobile(true)} aria-label="Open navigation"><Menu size={19}/></button><div className="breadcrumb"><span>Workspace</span><span className="slash">/</span><b>{page}</b></div><div className="top-actions"><span className="environment"><span className={`status-dot ${status ? 'on' : ''}`}></span>{status ? 'Host online' : 'Not connected'}</span><button className="icon-button" onClick={() => void refresh()} title="Refresh" aria-label="Refresh"><RefreshCw size={16}/></button><button className="key-button" onClick={() => go('Settings')}><KeyRound size={14}/><span>API key</span></button></div></header>
      <div className="content">
        {!key && <div className="notice"><LockKeyhole size={17}/><div><b>Connect to your gateway</b><span>Add your YAG API key to load host status and models. It stays in this browser session.</span></div><button onClick={() => go('Settings')}>Add API key <ArrowUpRight size={14}/></button></div>}
        {error && key && <div className="notice error"><CircleHelp size={17}/><div><b>Could not connect</b><span>{error}</span></div><button onClick={() => go('Settings')}>Check API key <ArrowUpRight size={14}/></button></div>}
        {page === 'Overview' && <Overview status={status} models={models} modelError={modelError} lastUpdated={lastUpdated} go={go} refresh={refresh}/>}
        {page === 'Playground' && <Playground apiKey={key} models={selectableModels} model={model} setModel={setModel}/>}
        {page === 'Models' && <Models apiKey={key} models={models} routes={routes} capabilities={capabilities} routeError={routeError} modelError={modelError} refresh={refresh} go={go}/>}
        {page === 'Integrations' && <Integrations model={model}/>}
        {page === 'Requests' && <Requests status={status} metrics={metrics} metricsError={metricsError} lastUpdated={lastUpdated} refresh={refresh}/>}
        {page === 'Settings' && <Settings keyDraft={keyDraft} setKeyDraft={setKeyDraft} saveKey={saveKey} connected={!!key}/>}
      </div><footer><span>YAG <span className="footer-sep">/</span> ONE HOST. MULTIPLE MODELS. EVERY INTERFACE.</span><span>SELF-HOSTED INFERENCE GATEWAY</span></footer>
    </main>
  </div>
}
function PageHead({eyebrow, title, description, action}: {eyebrow: string; title: string; description: string; action?: React.ReactNode}) { return <div className="page-heading"><div><div className="eyebrow"><span></span>{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div> }
function Overview({status, models, modelError, lastUpdated, go, refresh}: {status: Status | null; models: Model[]; modelError: string; lastUpdated: Date | null; go: (p: Page) => void; refresh: () => Promise<void>}) {
  return <><PageHead eyebrow="YOUR GATEWAY" title="Overview" description="A clear view of your inference gateway and the models behind it." action={<button className="outline-button" onClick={() => void refresh()}><RefreshCw size={14}/> Refresh</button>}/>
    <div className="section-heading"><div><span className="section-number">01</span><h2>Host overview</h2></div><span className="updated">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : 'Waiting for connection'}</span></div>
    <div className="metrics"><div className="metric"><div className="metric-label">HOST STATUS <Server size={15}/></div><div className="metric-value"><span className={`status-dot ${status ? 'on' : ''}`}></span>{status ? 'Online' : 'Unavailable'}</div><div className="metric-detail">{status ? 'Gateway is responding' : 'Connect to check status'}</div></div><div className="metric"><div className="metric-label">AVAILABLE MODELS <Layers3 size={15}/></div><div className="metric-value">{status && !modelError ? String(models.length).padStart(2,'0') : '—'}</div><div className="metric-detail">{modelError ? 'Backend unavailable' : 'Discovered from backend'}</div></div><div className="metric"><div className="metric-label">ACTIVE CONNECTIONS <Activity size={15}/></div><div className="metric-value">{status ? String(status.active_connections).padStart(2,'0') : '—'}</div><div className="metric-detail">Includes this status request</div></div><div className="metric"><div className="metric-label">HOST UPTIME <Clock3 size={15}/></div><div className="metric-value">{status ? formatUptime(status.uptime_seconds) : '—'}</div><div className="metric-detail">Since last restart</div></div></div>
    <div className="overview-grid"><section className="panel models-panel"><div className="panel-head"><div><h2>Available models</h2><p>Models reported by your inference backend.</p></div><button className="text-link" onClick={() => go('Models')}>View all <ArrowUpRight size={14}/></button></div><div className="table-head"><span>MODEL ID</span><span>PROVIDER</span><span>STATUS</span></div>{models.length ? models.slice(0,5).map(m => <div className="model-row" key={m.id}><span className="model-name"><span className="model-icon"><Box size={15}/></span><span>{m.id}</span></span><span className="secondary">{m.owned_by || 'Not reported'}</span><span className="model-status"><span className="status-dot on"/> Listed</span></div>) : <div className="empty-table"><Box size={20}/><b>{modelError ? 'Unable to discover models' : 'No models to display'}</b><span>{modelError || 'Connect a backend and add your API key to get started.'}</span></div>}<div className="panel-foot"><span>LIVE MODEL DISCOVERY</span><span>OPENAI-COMPATIBLE <ArrowUpRight size={12}/></span></div></section>
      <section className="panel quick-panel"><div className="panel-head"><div><h2>Get connected</h2><p>Put your local models to work.</p></div></div><button className="quick-link" onClick={() => go('Playground')}><span className="quick-icon"><MessageSquare size={17}/></span><span><b>Open playground</b><small>Send a request to a model</small></span><ArrowUpRight size={16}/></button><button className="quick-link" onClick={() => go('Integrations')}><span className="quick-icon"><Code2 size={17}/></span><span><b>Connect an application</b><small>Explore API configuration</small></span><ArrowUpRight size={16}/></button><button className="quick-link" onClick={() => go('Settings')}><span className="quick-icon"><ShieldCheck size={17}/></span><span><b>Gateway settings</b><small>Manage your connection</small></span><ArrowUpRight size={16}/></button></section></div>
    <div className="section-heading lower"><div><span className="section-number">02</span><h2>System resources</h2></div><span className="updated">HOST METRICS</span></div><div className="resource-line"><Cpu size={17}/><div><b>Resource metrics not available</b><span>CPU, memory and GPU monitoring are not supported in this version.</span></div><span className="tag">NOT REPORTED</span></div>
  </>
}
function Models({apiKey,models,routes,capabilities,routeError,modelError,refresh,go}: {apiKey:string; models: Model[]; routes: Route[]; capabilities:ModelCapability[]; routeError: string; modelError: string; refresh: () => Promise<void>; go: (p: Page) => void}) { return <><PageHead eyebrow="INFERENCE" title="Models" description="Model identifiers discovered from the configured upstream backend." action={<button className="outline-button" onClick={() => void refresh()}><RefreshCw size={14}/> Refresh</button>}/><section className="panel"><div className="panel-head"><div><h2>Model registry</h2><p>Live response from the upstream /models endpoint.</p></div><span className="tag">{models.length} LISTED</span></div><div className="table-head"><span>MODEL ID</span><span>PROVIDER</span><span>STATUS</span></div>{models.length ? models.map(m => <div className="model-row" key={m.id}><span className="model-name"><span className="model-icon"><Box size={15}/></span>{m.id}</span><span className="secondary">{m.owned_by || 'Not reported'}</span><span className="model-status"><span className="status-dot on"/> Listed</span></div>) : <div className="empty-table"><Box size={20}/><b>No models to display</b><span>{modelError || 'Add an API key and configure an inference backend.'}</span><button className="text-link" onClick={() => go('Settings')}>Connection settings <ArrowUpRight size={14}/></button></div>}</section><section className="panel"><div className="panel-head"><div><h2>Configured routes</h2><p>Model IDs mapped to separate backends. These are configuration entries, not health checks.</p></div><span className="tag">{routes.length} CONFIGURED</span></div><div className="setting-row"><div><b>Default provider</b><small>Checks HTTP reachability of /models only</small></div><ProviderProbe apiKey={apiKey}/></div><div className="table-head"><span>MODEL ID</span><span>TYPE</span><span>STATUS</span></div>{routes.length ? routes.map(r => <div className="model-row" key={r.model}><span className="model-name"><span className="model-icon"><Layers3 size={15}/></span>{r.model}</span><span className="secondary">{r.circuit_open?'Circuit open':r.consecutive_connect_failures?'Connection failures: '+r.consecutive_connect_failures:'Model route'}</span><ProviderProbe apiKey={apiKey} model={r.model}/></div>) : <div className="empty-table"><Layers3 size={20}/><b>No configured routes</b><span>{routeError || 'Define YAG_MODEL_ROUTES on the Host to add routed models.'}</span></div>}</section><section className="panel"><div className="panel-head"><div><h2>Declared model capabilities</h2><p>Operator-configured hints, never inferred or live-verified by the gateway.</p></div></div>{capabilities.length ? capabilities.map(item=><div className="setting-row" key={item.model}><div><b>{item.model}</b><small>{item.declared?'Operator declaration':'No capabilities declared'}</small></div><span className="tiny-note">Tools: {item.capabilities.tools===null?'Unknown':item.capabilities.tools?'Yes':'No'} · Streaming: {item.capabilities.streaming===null?'Unknown':item.capabilities.streaming?'Yes':'No'} · Vision: {item.capabilities.vision===null?'Unknown':item.capabilities.vision?'Yes':'No'} · Context: {item.capabilities.max_context_tokens??'Unknown'}</span></div>) : <div className="setting-row"><span className="tiny-note">No configured routes.</span></div>}</section><div className="info-block"><CircleHelp size={16}/><span>Provider setup is managed through host environment variables. HTTP reachability probes do not validate model capabilities. A circuit may open after configured connection failures.</span></div></> }
function ProviderProbe({apiKey,model}: {apiKey:string;model?:string}) {
  const [result,setResult]=useState<{reachable:boolean;upstream_status:number}|null>(null)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const check=async () => {
    if(!apiKey || busy)return
    setBusy(true);setErr('');setResult(null)
    try {
      const response=await api('/api/provider/check',apiKey,{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(model?{model}:{})})
      setResult(await response.json())
    } catch(e) {setErr((e as Error).message)} finally {setBusy(false)}
  }
  return <div className="route-check"><button type="button" className="outline-button small"
    disabled={!apiKey || busy} onClick={() => void check()}>{busy?'Checking…':'Check HTTP'}</button>
    {result && <span className="tiny-note">{result.reachable?'Reachable':'Unavailable'} · HTTP {result.upstream_status || '—'}</span>}
    {err && <span className="tiny-note">{err}</span>}</div>
}
function Playground({apiKey,models,model,setModel}: {apiKey: string; models: Model[]; model: string; setModel: (m: string) => void}) {
  const [messages,setMessages] = useState<Message[]>([]), [input,setInput] = useState(''), [busy,setBusy] = useState(false), [err,setErr] = useState(''), [temperature,setTemperature] = useState('0.7')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); const text=input.trim(); if(!text || busy || !apiKey || !model) return
    const history: Message[]=[...messages,{role:'user',content:text}]; setMessages([...history,{role:'assistant',content:''}]); setInput(''); setErr(''); setBusy(true); const ctrl=new AbortController(); controller.current=ctrl
    try {
      const res=await api('/v1/chat/completions',apiKey,{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages:history,stream:true,temperature:Number(temperature)})})
      if(!res.body) throw new Error('Streaming response unavailable')
      const reader=res.body.getReader(), decoder=new TextDecoder(); let buffer='', completed=false
      const processEvent=(event: string) => { const data=event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if(!data) return; if(data==='[DONE]'){completed=true;return} let chunk; try { chunk=JSON.parse(data) } catch { throw new Error('Invalid streaming event from backend') } if(chunk.error) throw new Error(chunk.error.message || 'Backend stream error'); const delta=chunk.choices?.[0]?.delta; if(delta?.tool_calls) throw new Error('Playground does not support tool calls'); const content=delta?.content; if(typeof content==='string') setMessages(current => { const next=[...current]; const last=next[next.length-1]; if(last?.role==='assistant') next[next.length-1]={...last,content:last.content+content}; return next }) }
      while(true) { const {done,value}=await reader.read(); buffer+=decoder.decode(value,{stream:!done}); const events=buffer.split(/\r?\n\r?\n/); buffer=events.pop() || ''; for(const event of events) processEvent(event); if(done) break }
      if(buffer.trim()) processEvent(buffer); if(!completed) throw new Error('Stream ended before completion')
    } catch(e) { if((e as Error).name!=='AbortError') setErr((e as Error).message); else setErr('Request cancelled.') } finally {setBusy(false);controller.current=null}
  }
  return <><PageHead eyebrow="INTERACT" title="Playground" description="Talk to a model through the same public API your applications use."/><div className="play-layout"><section className="panel chat-panel"><div className="panel-head"><div><h2>Conversation</h2><p>Streaming Chat Completions</p></div><button className="outline-button small" disabled={busy || !messages.length} onClick={() => {setMessages([]);setErr('')}}>Clear conversation</button></div><div className="conversation">{messages.length ? messages.map((m,i) => <div className={`message ${m.role}`} key={i}><div className="message-avatar">{m.role==='user'?'YOU':'YAG'}</div><div className="message-content"><b>{m.role==='user'?'You':'Assistant'}</b><div className="markdown"><ReactMarkdown>{m.content || (busy && i===messages.length-1?'Waiting for response…':'')}</ReactMarkdown></div></div></div>) : <div className="chat-empty"><div className="chat-empty-icon"><MessageSquare size={23}/></div><b>Start a conversation</b><span>Select a model and send a message to test your gateway.</span></div>}</div>{err && <div className="inline-error">{err}</div>}<form className="composer" onSubmit={send}><textarea value={input} onChange={e => setInput(e.target.value)} placeholder="Write a message…" rows={3} onKeyDown={e => {if(e.key==='Enter' && !e.shiftKey && !e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}}/><div className="composer-bottom"><span>ENTER TO SEND · SHIFT + ENTER FOR A NEW LINE</span>{busy ? <button type="button" className="primary-button" onClick={() => controller.current?.abort()}><Square size={14}/> Stop</button> : <button className="primary-button" disabled={!apiKey || !model || !input.trim()}><Send size={14}/> Send message</button>}</div></form></section><aside className="panel play-settings"><div className="panel-head"><div><h2>Configuration</h2><p>Parameters for this conversation.</p></div></div><label>MODEL<select value={model} onChange={e => setModel(e.target.value)} disabled={busy || !models.length}>{models.length ? models.map(m => <option key={m.id} value={m.id}>{m.id}</option>) : <option value="">No models available</option>}</select></label><label>TEMPERATURE <span>{temperature}</span><input type="range" min="0" max="2" step="0.1" value={temperature} onChange={e => setTemperature(e.target.value)} disabled={busy}/></label><div className="settings-hint"><CircleHelp size={15}/> The playground supports text chat. Tool execution remains the responsibility of your client.</div></aside></div></>
}
function CopyBlock({text}: {text: string}) { const [copied,setCopied]=useState(false); return <div className="code-block"><button onClick={async () => {try {await navigator.clipboard.writeText(text);setCopied(true);setTimeout(() => setCopied(false),2000)} catch { setCopied(false) }}} title="Copy to clipboard">{copied?<Check size={15}/>:<Clipboard size={15}/>} {copied?'Copied':'Copy'}</button><pre>{text}</pre></div> }
function Integrations({model}: {model: string}) {
  const [protocol,setProtocol]=useState<'chat'|'responses'|'anthropic'>('chat')
  const base=window.location.origin
  const shell=(s:string)=>"'"+s.replace(/'/g,"'\\''")+"'"
  const chosen=model||'YOUR_MODEL'
  const samples={
    chat:{title:'Chat Completions',path:'/v1/chat/completions',body:{
      model:chosen,messages:[{role:'user',content:'Hello'}],stream:false}},
    responses:{title:'Responses API',path:'/v1/responses',body:{
      model:chosen,input:'Hello',store:false,stream:false}},
    anthropic:{title:'Anthropic Messages',path:'/v1/messages',body:{
      model:chosen,max_tokens:128,messages:[{role:'user',content:'Hello'}],stream:false}}
  }
  const selected=samples[protocol]
  const headers=['  -H "Authorization: Bearer $YAG_API_KEY" \\',
    "  -H 'Content-Type: application/json' \\"]
  if(protocol==='anthropic')headers.push("  -H 'anthropic-version: 2023-06-01' \\")
  const curl=["export YAG_API_KEY='your-yag-api-key'",
    'curl '+shell(base+selected.path)+' \\',
    ...headers,'  -d '+shell(JSON.stringify(selected.body,null,2))].join('\n')
  return <><PageHead eyebrow="CONNECT" title="Integrations"
    description="Connect your applications to a self-hosted inference gateway."/>
    <div className="integration-grid"><section className="panel integration-main">
      <div className="panel-head"><div><h2>Client configuration</h2>
        <p>Choose a protocol and copy its curl example.</p></div>
        <span className="tag green">LOCAL API</span></div>
      <div className="integration-body">
        <div className="field-caption">BASE URL</div>
        <div className="endpoint"><code>{base}/v1</code><span>YAG GATEWAY</span></div>
        <p>Authenticate with a YAG gateway key. The upstream credential stays server-side.</p>
        <div className="protocol-tabs" role="group" aria-label="Protocol sample">
          {(['chat','responses','anthropic'] as const).map(p=>
            <button type="button" key={p} aria-pressed={protocol===p}
              className={protocol===p?'selected':''} onClick={()=>setProtocol(p)}>
              {samples[p].title}
            </button>)}
        </div>
        <div className="field-caption">EXAMPLE REQUEST</div>
        <CopyBlock text={curl}/>
        <p className="tiny-note">A discovered model is selected when available. Replace the example key with your gateway key. Protocol translation and model features may differ.</p>
      </div></section>
      <section className="panel integration-side">
        <div className="panel-head"><div><h2>Protocol support</h2>
          <p>Gateway-level capabilities, not model guarantees.</p></div></div>
        <div className="protocol-row"><div><b>Chat Completions</b>
          <small>OpenAI-compatible upstream passthrough</small></div><span className="tag green">AVAILABLE</span></div>
        <div className="protocol-row"><div><b>Responses API</b>
          <small>Codex CLI text and shell-tool cycle verified on mock</small></div><span className="tag">PARTIAL</span></div>
        <div className="protocol-row"><div><b>Anthropic Messages</b>
          <small>Claude Code CLI text and Read-tool cycle verified on mock</small></div><span className="tag">PARTIAL</span></div>
        <div className="integration-note">
          No real inference-model compatibility has been certified. Built-in server tools,
          native thinking blocks, multimodal inputs and native token counting are not supported.
          YAG never executes client tools.
        </div>
      </section></div></>
}
function Requests({status,metrics,metricsError,lastUpdated,refresh}: {status:Status|null;metrics:Metrics|null;metricsError:string;lastUpdated:Date|null;refresh:() => Promise<void>}) {
  return <><PageHead eyebrow="OBSERVABILITY" title="Requests" description="Aggregate in-memory request counts without storing prompts or responses."
    action={<button className="outline-button" onClick={() => void refresh()}><RefreshCw size={14}/> Refresh</button>}/>
    <div className="metrics">
      <div className="metric"><div className="metric-label">CHAT COMPLETIONS <MessageSquare size={15}/></div><div className="metric-value">{metrics?metrics.chat_requests.toLocaleString():'—'}</div><div className="metric-detail">Submitted Chat requests</div></div>
      <div className="metric"><div className="metric-label">RESPONSES API <Code2 size={15}/></div><div className="metric-value">{metrics?metrics.responses_requests.toLocaleString():'—'}</div><div className="metric-detail">Submitted Responses requests</div></div>
      <div className="metric"><div className="metric-label">ANTHROPIC MESSAGES <Braces size={15}/></div><div className="metric-value">{metrics?metrics.anthropic_requests.toLocaleString():'—'}</div><div className="metric-detail">Submitted Messages requests</div></div>
    </div>
    <section className="panel"><div className="panel-head"><div><h2>Gateway operations</h2><p>Since the last Host restart; counts are not inference success rates.</p></div></div>
      <div className="setting-row"><div><b>Model listing</b><small>GET /v1/models requests</small></div><b>{metrics?metrics.model_list_requests.toLocaleString():'—'}</b></div>
      <div className="setting-row"><div><b>Provider probes</b><small>POST /api/provider/check requests</small></div><b>{metrics?metrics.provider_check_requests.toLocaleString():'—'}</b></div>
      <div className="setting-row"><div><b>Active HTTP connections</b><small>Includes the status poll itself</small></div><b>{status?status.active_connections.toLocaleString():'—'}</b></div>
      <div className="setting-row"><div><b>Upstream requests completed</b><small>All model routes, including failed attempts</small></div><b>{metrics?metrics.upstream_attempts.toLocaleString():'—'}</b></div>
      <div className="setting-row"><div><b>Upstream successful HTTP responses</b><small>2xx–3xx responses counted after transfer completion</small></div><b>{metrics?metrics.upstream_successes.toLocaleString():'—'}</b></div>
      <div className="setting-row"><div><b>Upstream transport / HTTP errors</b><small>Failures reported by libcurl or HTTP</small></div><b>{metrics?(metrics.upstream_transport_failures+metrics.upstream_http_errors).toLocaleString():'—'}</b></div>
      <div className="setting-row"><div><b>Average upstream attempt duration</b><small>End-to-end transport duration, not time to first token</small></div><b>{metrics?.upstream_attempts?(metrics.upstream_total_latency_ms/metrics.upstream_attempts).toFixed(0)+' ms':'—'}</b></div>
      <div className="setting-row"><div><b>Circuit breaker rejections</b><small>Requests bypassed after connection failures</small></div><b>{metrics?metrics.circuit_rejections.toLocaleString():'—'}</b></div>
    </section>
    {metricsError && <div className="info-block"><CircleHelp size={16}/><span>{metricsError}</span></div>}
    <div className="info-block"><LockKeyhole size={16}/><span>No prompt text, response bodies or request histories are persisted. Metrics are counts of accepted API requests, including ones that later fail. {lastUpdated ? 'Last refreshed '+lastUpdated.toLocaleTimeString() : ''}</span></div>
  </>
}
function Settings({keyDraft,setKeyDraft,saveKey,connected}: {keyDraft:string;setKeyDraft:(s:string)=>void;saveKey:(e:React.FormEvent)=>void;connected:boolean}) { return <><PageHead eyebrow="CONFIGURATION" title="Settings" description="Manage your Console connection to the gateway."/><div className="settings-layout"><section className="panel"><div className="panel-head"><div><h2>API authentication</h2><p>Use the API key configured on your YAG Host.</p></div><KeyRound size={17} className="muted"/></div><form className="settings-form" onSubmit={saveKey}><label htmlFor="api-key">YAG API KEY</label><input id="api-key" type="password" autoComplete="off" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder="Enter your gateway API key"/><p>The key is kept in session storage for this tab and sent only to this gateway. Clear it by saving an empty value.</p><button className="primary-button" type="submit">Save connection</button>{connected && <span className="saved-indicator"><Check size={14}/> Key saved for this session</span>}</form></section><section className="panel"><div className="panel-head"><div><h2>Host configuration</h2><p>Managed on the machine running YAG.</p></div></div><div className="settings-body"><div className="setting-row"><div><b>Network &amp; provider</b><small>Configure via host environment variables</small></div><span className="tag">HOST MANAGED</span></div><div className="setting-row"><div><b>Credentials &amp; access</b><small>Restart the host to rotate the API key</small></div><span className="tag">HOST MANAGED</span></div><div className="security-note"><ShieldCheck size={16}/><span>YAG binds to localhost by default. Use a trusted TLS reverse proxy and firewall before exposing it on your network.</span></div></div></section></div></> }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
