import React, { useCallback, useEffect, useState } from 'react'
import { Activity, Box, CircleHelp, Cpu, Download, HardDrive, KeyRound, Layers3, RefreshCw, Server, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import './control.css'

type OllamaModel = { name: string; model?: string; size?: number; modified_at?: string }
type OllamaList = { models: OllamaModel[] }
type OllamaLoaded = { models: {name?: string; model?: string; size_vram?: number}[] }
type PullJob = { job_id: number; status: 'idle'|'running'|'completed'|'failed'; model: string; upstream_http_status: number }
type Client = { id: number; name: string; scope: string; enabled: boolean; managed: boolean; accepted_requests: number; rate_limited_requests: number }
type ClientList = {data: Client[]}
type ResourceMetrics = {
  scope: string;
  cpu: {available: boolean; logical_cores_visible?: number; load_1?: number;load_5?: number;load_15?: number;utilization_percent?: number}
  memory: {available: boolean;scope: string;used_bytes?: number;limit_bytes?: number;visible_host_total_bytes?: number;visible_host_available_bytes?: number;visible_host_scope?: string}
  gpu: {available: boolean;scope?: string;devices?: {id:string;utilization_percent?:number;vram_used_bytes?:number;vram_total_bytes?:number;temperature_c?:number}[]}
}
type Scheduler = {max_inference:number;max_per_key:number;queue_wait_ms:number;active:number;waiting:number}
type Pool = {data:{index:number;role:string;active_requests:number;attempts:number;successes:number;failures:number;cooldown_seconds:number;declared_models?:string[];model_allowlist_enabled?:boolean}[]}
type ClientCreated = {id:number;api_key:string;enabled:boolean}

async function controlRequest<T>(key: string, path: string, method = 'GET', payload?: unknown): Promise<T> {
  if (!key) throw new Error('Enter the primary administrator API key in Settings')
  const res = await fetch(path, {method, headers:{
    'Authorization':'Bearer '+key,
    ...(payload === undefined ? {} : {'Content-Type':'application/json'}),
  }, body: payload === undefined ? undefined : JSON.stringify(payload)})
  if (!res.ok) {
    let reason='HTTP '+res.status
    try { const data=await res.json();reason=data.error?.message || reason } catch { /* no JSON error body */ }
    throw new Error(reason)
  }
  return await res.json() as T
}
function byteSize(value?: number) {
  if (typeof value!=='number' || !Number.isFinite(value)) return 'Not reported'
  return value >= 1024**3 ? (value/1024**3).toFixed(2)+' GiB'
    : value>=1024**2 ? (value/1024**2).toFixed(1)+' MiB'
    : value.toLocaleString()+' bytes'
}
function adminPost<T>(key:string,path:string,payload:unknown) {
  return controlRequest<T>(key,path,'POST',payload)
}

export default function ControlPlane({apiKey,onUseModel}:{apiKey:string;onUseModel:(name:string)=>void}) {
  const [models,setModels]=useState<OllamaModel[]>([])
  const [loaded,setLoaded]=useState<OllamaLoaded['models']>([])
  const [job,setJob]=useState<PullJob|null>(null)
  const [clients,setClients]=useState<Client[]>([])
  const [resources,setResources]=useState<ResourceMetrics|null>(null)
  const [scheduler,setScheduler]=useState<Scheduler|null>(null)
  const [pool,setPool]=useState<Pool['data']>([])
  const [modelInput,setModelInput]=useState('')
  const [clientName,setClientName]=useState('')
  const [clientScope,setClientScope]=useState('inference+models')
  const [newKey,setNewKey]=useState<ClientCreated|null>(null)
  const [busy,setBusy]=useState('')
  const [errors,setErrors]=useState<Record<string,string>>({})
  const [notice,setNotice]=useState('')

  const loadModels=useCallback(async()=>{
    if(!apiKey){setModels([]);setLoaded([]);setJob(null);return}
    try{
      const [installed,running,task]=await Promise.all([
        controlRequest<OllamaList>(apiKey,'/api/admin/ollama/models'),
        controlRequest<OllamaLoaded>(apiKey,'/api/admin/ollama/loaded'),
        controlRequest<PullJob>(apiKey,'/api/admin/ollama/jobs'),
      ])
      setModels(Array.isArray(installed.models)?installed.models:[])
      setLoaded(Array.isArray(running.models)?running.models:[])
      setJob(task);setErrors(prev=>({...prev,models:''}))
    }catch(e){setErrors(prev=>({...prev,models:(e as Error).message}))}
  },[apiKey])
  const loadClients=useCallback(async()=>{
    if(!apiKey){setClients([]);return}
    try{
      const reply=await controlRequest<ClientList>(apiKey,'/api/admin/clients')
      setClients(Array.isArray(reply.data)?reply.data:[])
      setErrors(prev=>({...prev,clients:''}))
    }catch(e){setErrors(prev=>({...prev,clients:(e as Error).message}))}
  },[apiKey])
  const loadInfra=useCallback(async()=>{
    if(!apiKey){setResources(null);setScheduler(null);setPool([]);return}
    try{
      const [hardware,queue,backends]=await Promise.all([
        controlRequest<ResourceMetrics>(apiKey,'/api/system/resources'),
        controlRequest<Scheduler>(apiKey,'/api/scheduler'),
        controlRequest<Pool>(apiKey,'/api/providers/pool'),
      ])
      setResources(hardware);setScheduler(queue);setPool(backends.data || [])
      setErrors(prev=>({...prev,infra:''}))
    }catch(e){setErrors(prev=>({...prev,infra:(e as Error).message}))}
  },[apiKey])
  const refresh=useCallback(async()=>{
    await Promise.all([loadModels(),loadClients(),loadInfra()])
  },[loadModels,loadClients,loadInfra])
  useEffect(()=>{
    void refresh()
    const timer=setInterval(()=>void refresh(),10000)
    return ()=>clearInterval(timer)
  },[refresh])
  async function pullModel() {
    const name=modelInput.trim()
    if(!name || busy)return
    setBusy('pull');setNotice('');setErrors(prev=>({...prev,models:''}))
    try{
      await adminPost(apiKey,'/api/admin/ollama/pull',{name})
      setModelInput('');setNotice('Model download/update queued. Check the job below.')
      await loadModels()
    }catch(e){setErrors(prev=>({...prev,models:(e as Error).message}))}
    finally{setBusy('')}
  }
  async function removeModel(name:string) {
    if(busy || !window.confirm('Delete the installed model '+name+' from Ollama?'))return
    setBusy('delete');setNotice('')
    try{
      await adminPost(apiKey,'/api/admin/ollama/delete',{name})
      setNotice('Model '+name+' deleted')
      await loadModels()
    }catch(e){setErrors(prev=>({...prev,models:(e as Error).message}))}
    finally{setBusy('')}
  }
  async function createClient(event:React.FormEvent) {
    event.preventDefault()
    if(busy || !clientName.trim())return
    setBusy('client');setNewKey(null)
    try{
      const result=await adminPost<ClientCreated>(apiKey,'/api/admin/clients',
        {name:clientName.trim(),scope:clientScope})
      setNewKey(result);setClientName('')
      await loadClients()
    }catch(e){setErrors(prev=>({...prev,clients:(e as Error).message}))}
    finally{setBusy('')}
  }
  async function clientAction(client:Client,action:'enable'|'disable'|'revoke'|'rename') {
    if(busy)return
    let name=client.name
    if(action==='rename') {
      const renamed=window.prompt('New name for '+client.name,client.name)
      if(renamed===null || !renamed.trim())return
      name=renamed.trim()
    }
    if(action==='revoke' && !window.confirm(
        'Revoke '+client.name+'? Managed keys are deleted permanently. Static keys are disabled.'))return
    setBusy('client-action')
    try{
      await adminPost(apiKey,'/api/admin/clients/'+action,
        action==='rename'?{id:client.id,name}:{id:client.id})
      await loadClients()
      setNotice('Client '+action+' completed')
    }catch(e){setErrors(prev=>({...prev,clients:(e as Error).message}))}
    finally{setBusy('')}
  }
  const activeVram=loaded.reduce((sum,m)=>sum+(m.size_vram||0),0)
  return <div className="control-plane">
    <div className="page-heading"><div><div className="eyebrow"><span/> AI CONTROL PLANE</div>
      <h1>Central AI server</h1>
      <p>Manage Ollama, LAN client keys, inference admission and the configured replica pool.</p></div>
      <button className="outline-button" onClick={()=>void refresh()}><RefreshCw size={14}/> Refresh</button>
    </div>
    <div className="info-block"><ShieldCheck size={16}/><span>
      Administration requires the primary server key. These actions are available from
      the central machine's localhost Console; the LAN TLS proxy blocks administrative URLs.
    </span></div>
    {notice && <div className="control-notice">{notice}</div>}
    <div className="control-grid">
      <section className="panel control-wide">
        <div className="panel-head"><div><h2><Box size={16}/> Ollama model manager</h2>
          <p>Install, update, delete and select installed models. Pulls run in the background.</p></div>
          <span className="tag">{models.length} INSTALLED</span></div>
        <form className="control-form" onSubmit={e=>{e.preventDefault();void pullModel()}}>
          <input aria-label="Ollama model to install or update" value={modelInput}
            onChange={e=>setModelInput(e.target.value)}
            placeholder="Model ID, e.g. llama3.2:latest" maxLength={254}/>
          <button className="primary-button" disabled={!apiKey || !!busy || !modelInput.trim()}>
            <Download size={14}/> Pull / update
          </button>
        </form>
        {job && job.status!=='idle' && <div className="control-job">
          <Activity size={15}/> {job.model}: {job.status}
          {job.status==='failed' && <span> · Backend HTTP {job.upstream_http_status||'unavailable'}</span>}
        </div>}
        {errors.models && <div className="control-error">{errors.models}</div>}
        <div className="control-table">
          {models.map(m=><div className="control-model" key={m.name}>
            <div><b>{m.name}</b><small>{byteSize(m.size)}
              {loaded.some(x=>(x.name||x.model)===m.name)?' · Loaded in Ollama':''}</small></div>
            <div className="control-actions">
              <button className="outline-button small" onClick={()=>onUseModel(m.name)}>Use in Playground</button>
              <button className="outline-button small danger" disabled={!!busy}
                onClick={()=>void removeModel(m.name)}><Trash2 size={13}/> Delete</button>
            </div>
          </div>)}
          {!models.length && !errors.models && <div className="control-empty">No installed models reported. Pull a compatible Ollama model first.</div>}
        </div>
      </section>
      <section className="panel control-wide">
        <div className="panel-head"><div><h2><KeyRound size={16}/> LAN client keys</h2>
          <p>Issue separate keys, rename clients and disable or revoke access without restarting YAG.</p></div>
          <span className="tag">{clients.length} CLIENTS</span></div>
        <form className="control-form" onSubmit={e=>void createClient(e)}>
          <input aria-label="New client name" value={clientName} maxLength={48}
            onChange={e=>setClientName(e.target.value)} placeholder="Client name (e.g. Studio PC)"/>
          <select aria-label="Client scope" value={clientScope} onChange={e=>setClientScope(e.target.value)}>
            <option value="inference+models">Inference + models</option>
            <option value="inference">Inference only</option>
            <option value="models">Model discovery only</option>
            <option value="monitor">Monitoring only</option>
          </select>
          <button className="primary-button" disabled={!apiKey || !!busy || !clientName.trim()}>
            <UserPlus size={14}/> Add client
          </button>
        </form>
        {newKey && <div className="control-key">
          <b>New API key for client #{newKey.id} — displayed only once</b>
          <code>{newKey.api_key}</code>
          <button className="outline-button small" onClick={()=>void navigator.clipboard.writeText(newKey.api_key)}>Copy key</button>
          <button className="outline-button small" onClick={()=>setNewKey(null)}>Dismiss</button>
        </div>}
        {errors.clients && <div className="control-error">{errors.clients}</div>}
        <div className="control-table">
          {clients.map(c=><div className="control-model" key={c.id}>
            <div><b>{c.name}</b><small>Client #{c.id} · {c.scope}
              {' · '}{c.enabled?'Active':'Disabled'}
              {' · '}{c.accepted_requests} accepted</small></div>
            <div className="control-actions">
              <button className="outline-button small" disabled={!!busy}
                onClick={()=>void clientAction(c,'rename')}>Rename</button>
              <button className="outline-button small" disabled={!!busy}
                onClick={()=>void clientAction(c,c.enabled?'disable':'enable')}>
                {c.enabled?'Disable':'Enable'}</button>
              <button className="outline-button small danger" disabled={!!busy}
                onClick={()=>void clientAction(c,'revoke')}>Revoke</button>
            </div>
          </div>)}
          {!clients.length && !errors.clients && <div className="control-empty">No client keys configured.</div>}
        </div>
        <div className="control-footnote">Static keys can be disabled live, but their secrets remain in the bootstrap configuration.
          Managed keys can be permanently revoked. Previously started inferences may complete.</div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2><Cpu size={16}/> System telemetry</h2>
          <p>Gateway cgroup metrics, visible Linux kernel values and driver-dependent GPU sensors are identified separately.</p></div></div>
        {errors.infra && <div className="control-error">{errors.infra}</div>}
        <div className="setting-row"><div><b>Visible CPU cores</b><small>Gateway runtime</small></div>
          <b>{resources?.cpu.logical_cores_visible ?? 'Unavailable'}</b></div>
        <div className="setting-row"><div><b>Load average (1 min)</b><small>Linux reported load</small></div>
          <b>{resources?.cpu.load_1?.toFixed(2) ?? 'Unavailable'}</b></div>
        <div className="setting-row"><div><b>CPU utilization</b><small>/proc/stat · sampled between refreshes</small></div>
          <b>{resources?.cpu.utilization_percent === undefined?'Sampling…':resources.cpu.utilization_percent.toFixed(1)+'%'}</b></div>
        <div className="setting-row"><div><b>Memory usage</b><small>cgroup v2 · gateway container</small></div>
          <b>{byteSize(resources?.memory.used_bytes)}</b></div>
        <div className="setting-row"><div><b>Memory limit</b><small>Container cgroup limit</small></div>
          <b>{byteSize(resources?.memory.limit_bytes)}</b></div>
        <div className="setting-row"><div><b>Linux-visible RAM</b><small>/proc/meminfo · may describe host even inside container</small></div>
          <b>{byteSize(resources?.memory.visible_host_total_bytes)}</b></div>
        <div className="setting-row"><div><b>Linux-visible available RAM</b><small>/proc/meminfo · separate from cgroup limit</small></div>
          <b>{byteSize(resources?.memory.visible_host_available_bytes)}</b></div>
        <div className="setting-row"><div><b>Loaded model VRAM</b><small>Sum reported by Ollama /api/ps</small></div>
          <b>{loaded.length?byteSize(activeVram):'Not reported'}</b></div>
        {(resources?.gpu.devices||[]).map(g=><React.Fragment key={g.id}>
          <div className="setting-row"><div><b>{g.id} · GPU usage</b><small>Visible Linux DRM sysfs (driver dependent)</small></div>
            <b>{g.utilization_percent===undefined?'Not reported':g.utilization_percent+'%'}</b></div>
          <div className="setting-row"><div><b>{g.id} · VRAM</b><small>Used / total reported by driver</small></div>
            <b>{byteSize(g.vram_used_bytes)} / {byteSize(g.vram_total_bytes)}</b></div>
          <div className="setting-row"><div><b>{g.id} · Temperature</b><small>GPU hwmon sensor</small></div>
            <b>{g.temperature_c===undefined?'Not reported':g.temperature_c.toFixed(1)+' °C'}</b></div>
        </React.Fragment>)}
        <div className="control-footnote">GPU sensor availability depends on Linux sysfs access and the driver. NVIDIA and other devices without DRM counters require an external exporter; unavailable values are never estimated.</div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2><Activity size={16}/> Inference scheduler</h2>
          <p>Bounded FIFO queue with per-client and global concurrency limits.</p></div></div>
        <div className="setting-row"><div><b>Running requests</b></div><b>{scheduler?.active ?? '—'}</b></div>
        <div className="setting-row"><div><b>Waiting in queue</b></div><b>{scheduler?.waiting ?? '—'}</b></div>
        <div className="setting-row"><div><b>Global capacity</b></div><b>{scheduler?.max_inference || 'Unlimited'}</b></div>
        <div className="setting-row"><div><b>Per-key concurrency</b></div><b>{scheduler?.max_per_key || 'Unlimited'}</b></div>
        <div className="setting-row"><div><b>Maximum queue wait</b></div>
          <b>{scheduler?.queue_wait_ms === undefined?'—':scheduler.queue_wait_ms+' ms'}</b></div>
      </section>
      <section className="panel control-wide">
        <div className="panel-head"><div><h2><Server size={16}/> Multi-server inference pool</h2>
          <p>Least-inflight selection for replicas with matching model inventories; health cooldown after failures.</p></div>
          <span className="tag">{pool.length} BACKENDS</span></div>
        <div className="provider-table-wrap"><table className="provider-table">
          <thead><tr><th>BACKEND</th><th>RUNNING</th><th>ATTEMPTS</th>
            <th>SUCCESS</th><th>FAILURES</th><th>COOLDOWN</th><th>MODELS</th></tr></thead>
          <tbody>{pool.map(p=><tr key={p.index}><td><b>{p.role} #{p.index}</b></td>
            <td>{p.active_requests}</td><td>{p.attempts}</td><td>{p.successes}</td>
            <td>{p.failures}</td><td>{p.cooldown_seconds ? p.cooldown_seconds+' s':'Ready'}</td>
            <td>{p.model_allowlist_enabled ? p.declared_models?.join(', ') : 'Unrestricted'}</td></tr>)}</tbody>
        </table></div>
        <div className="control-footnote">For heterogeneous replicas, declare the supported model IDs in the backend's <code>models</code> allowlist. Absence of this field preserves legacy unrestricted routing; YAG does not automatically verify inventory or model semantics. Configure replica endpoints on the central server with
          <code> python scripts/lan.py providers add --url http://colibri2:11434/v1</code>,
          then apply with <code>python scripts/lan.py up</code>. Upstream credentials and addresses
          are never returned by the monitoring API.</div>
      </section>
      <section className="panel control-wide">
        <div className="panel-head"><div><h2><HardDrive size={16}/> Maintenance and backups</h2>
          <p>Run these privileged Docker operations on the central machine, not inside the gateway.</p></div></div>
        <div className="setting-row"><div><b>Encrypted configuration backup</b>
          <small>Includes keys, runtime registry and available Caddy CA materials; excludes model weights</small></div>
          <code>python scripts/lan.py backup --recipient AGE_PUBLIC_RECIPIENT</code></div>
        <div className="setting-row"><div><b>Controlled update</b>
          <small>Pull service images and rebuild gateway while preserving named volumes</small></div>
          <code>python scripts/lan.py update</code></div>
        <div className="control-footnote"><CircleHelp size={14}/> Backups require the age CLI and
          an external age identity for recovery. Schedule the command with cron or Task Scheduler.
          No Docker socket is mounted in YAG.</div>
      </section>
    </div>
  </div>
}
