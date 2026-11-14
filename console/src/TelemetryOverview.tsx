import React, { useEffect, useRef, useState } from 'react'
import { Activity, Cpu, Gauge, HardDrive, Layers3, Server } from 'lucide-react'
import './telemetry.css'

type Provider = { prompt_tokens:number; completion_tokens:number; usage_samples:number; attempts:number; successes:number; failures:number }
type Resource = {
  cpu?: { utilization_percent?:number }
  memory?: { used_bytes?:number; limit_bytes?:number; visible_host_available_bytes?:number; visible_host_total_bytes?:number }
  gpu?: { available:boolean; scope?:string; devices?: Array<{id:string;utilization_percent?:number;vram_used_bytes?:number;vram_total_bytes?:number;temperature_c?:number}> }
}
type Scheduler = { active:number; waiting:number; max_inference:number; max_per_key:number; queue_wait_ms:number }
type Sample = { at:string; rate:number|null; gpu:number|null }
type Snapshot = { providers:Provider[]; resources:Resource|null; scheduler:Scheduler|null }
const compact = (value:number) => new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value)
const percent = (used?:number,total?:number) => typeof used==='number' && typeof total==='number' && total>0
  ? Math.min(100,Math.max(0,used/total*100)) : null
const gib = (value?:number) => typeof value==='number' ? (value/1073741824).toFixed(1)+' GiB' : '—'
const read = async <T,>(path:string,key:string):Promise<T> => {
  const response = await fetch(path,{headers:{Authorization:'Bearer '+key},cache:'no-store'})
  if(!response.ok)throw new Error(path+' returned '+response.status)
  return response.json() as Promise<T>
}

export default function TelemetryOverview({apiKey}:{apiKey:string}) {
  const [snapshot,setSnapshot]=useState<Snapshot>({providers:[],resources:null,scheduler:null})
  const [samples,setSamples]=useState<Sample[]>([])
  const [mode,setMode]=useState<'tokens'|'gpu'>('tokens')
  const [error,setError]=useState('')
  const [updated,setUpdated]=useState('')
  const previous=useRef<{tokens:number;at:number}|null>(null)
  useEffect(()=>{
    previous.current=null
    setSnapshot({providers:[],resources:null,scheduler:null})
    setSamples([])
    setError('')
    setUpdated('')
    if(!apiKey)return
    let alive=true, running=false
    const poll=async()=>{
      if(running)return
      running=true
      try {
        const [p,r,s]=await Promise.allSettled([
          read<{data:Provider[]}>('/api/providers/status',apiKey),
          read<Resource>('/api/system/resources',apiKey),
          read<Scheduler>('/api/scheduler',apiKey),
        ])
        if(!alive)return
        const providers=p.status==='fulfilled' && Array.isArray(p.value.data)?p.value.data:[]
        const resources=r.status==='fulfilled'?r.value:null
        const scheduler=s.status==='fulfilled'?s.value:null
        setSnapshot({providers,resources,scheduler})
        setError([p,r,s].every(result=>result.status==='rejected')?'Monitoring endpoints are unavailable. Check your API key permissions.':'')
        const now=Date.now()
        const tokens=providers.reduce((sum,item)=>sum+Math.max(0,item.completion_tokens||0),0)
        const previousSample=previous.current
        const rate=providers.length && previousSample && tokens>=previousSample.tokens && now>previousSample.at
          ? (tokens-previousSample.tokens)*1000/(now-previousSample.at) : null
        if(providers.length)previous.current={tokens,at:now}
        const gpuDevice=resources?.gpu?.devices?.find(device=>typeof device.utilization_percent==='number')
        setSamples(rows=>[...rows,{at:new Date(now).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}),rate,gpu:gpuDevice?.utilization_percent??null}].slice(-36))
        setUpdated(new Date(now).toLocaleTimeString())
      }finally{running=false}
    }
    void poll()
    const timer=window.setInterval(()=>void poll(),5000)
    return ()=>{alive=false;window.clearInterval(timer)}
  },[apiKey])
  const providerTotals=snapshot.providers.reduce((a,p)=>({
    prompt:a.prompt+(p.prompt_tokens||0),completion:a.completion+(p.completion_tokens||0),
    usage:a.usage+(p.usage_samples||0),attempts:a.attempts+(p.attempts||0),
    successes:a.successes+(p.successes||0),failures:a.failures+(p.failures||0)
  }),{prompt:0,completion:0,usage:0,attempts:0,successes:0,failures:0})
  const gpu=snapshot.resources?.gpu?.devices?.[0]
  const vram=percent(gpu?.vram_used_bytes,gpu?.vram_total_bytes)
  const memory=snapshot.resources?.memory
  const cpu=snapshot.resources?.cpu
  const values=samples.map(s=>mode==='tokens'?s.rate:s.gpu)
  const max=Math.max(1,...values.filter((v):v is number=>v!==null))
  const hasGpu=Boolean(gpu)
  return <section className="telemetry-section" aria-label="Live observability">
    <div className="telemetry-heading"><div><span className="telemetry-kicker">LIVE OPERATIONS</span><h2>Inference telemetry</h2>
      <p>Aggregated counters since restart. No prompt or response content is collected.</p></div>
      <span className="telemetry-updated"><span className={updated?'telemetry-live-dot':''}/>{updated?'Sampled '+updated:'Awaiting data'} · 5 s</span></div>
    {error && <p className="telemetry-error" role="status">{error}</p>}
    <div className="telemetry-cards">
      <div className="telemetry-card"><div className="telemetry-card-name"><Layers3 size={16}/> INPUT TOKENS</div><strong>{providerTotals.usage?compact(providerTotals.prompt):'—'}</strong><small>Upstream-reported prompt tokens</small></div>
      <div className="telemetry-card"><div className="telemetry-card-name"><Gauge size={16}/> OUTPUT TOKENS</div><strong>{providerTotals.usage?compact(providerTotals.completion):'—'}</strong><small>Upstream-reported generated tokens</small></div>
      <div className="telemetry-card"><div className="telemetry-card-name"><Activity size={16}/> INFERENCE CALLS</div><strong>{snapshot.providers.length?compact(providerTotals.attempts):'—'}</strong><small>{compact(providerTotals.successes)} successful · {compact(providerTotals.failures)} failed</small></div>
      <div className="telemetry-card"><div className="telemetry-card-name"><Server size={16}/> SCHEDULER</div><strong>{snapshot.scheduler?snapshot.scheduler.active+' / '+(snapshot.scheduler.max_inference||'∞'):'—'}</strong><small>{snapshot.scheduler?snapshot.scheduler.waiting+' queued · '+(snapshot.scheduler.max_per_key||'∞')+' per key':'No scheduler data'}</small></div>
    </div>
    <div className="telemetry-grid">
      <div className="telemetry-chart-panel"><div className="telemetry-panel-head"><div><b>Runtime activity</b><span>Rolling 3-minute window, sampled locally</span></div><div className="telemetry-switch" role="group" aria-label="Chart metric"><button className={mode==='tokens'?'active':''} onClick={()=>setMode('tokens')} aria-pressed={mode==='tokens'}>Tokens/s</button><button className={mode==='gpu'?'active':''} onClick={()=>setMode('gpu')} aria-pressed={mode==='gpu'}>GPU %</button></div></div>
        <div className="telemetry-chart-number">{mode==='tokens'?(samples.at(-1)?.rate===null || samples.at(-1)?.rate===undefined?'—':samples.at(-1)!.rate!.toFixed(1)):(samples.at(-1)?.gpu===null || samples.at(-1)?.gpu===undefined?'—':samples.at(-1)!.gpu!.toFixed(0))}<span> {mode==='tokens'?'generated tokens/s':'GPU utilization %'}</span></div>
        <div className="telemetry-bars" role="img" aria-label={mode==='tokens'?'Generated token throughput history':'GPU utilization history'}>{samples.map((sample,index)=>{
          const value=mode==='tokens'?sample.rate:sample.gpu
          return <div key={index} className={'telemetry-bar '+(value===null?'missing':'')} style={{height:(value===null?3:Math.max(3,Math.round(value/max*100)))+'%'}} title={sample.at+' · '+(value===null?'Not reported':value.toFixed(1)+(mode==='tokens'?' tokens/s':'%'))}/>
        })}{samples.length===0 && <div className="telemetry-empty">Waiting for the first sample</div>}</div>
        <div className="telemetry-chart-foot"><span>{samples[0]?.at||'—'}</span><span>{samples.at(-1)?.at||'—'}</span></div>
        <small className="telemetry-disclaimer">Token throughput is derived from changes in reported usage counters, not a per-token streaming clock. Counters reset when YAG restarts.</small>
      </div>
      <div className="telemetry-hardware"><div className="telemetry-panel-head"><div><b>Hardware</b><span>Actual host-visible sensor readings</span></div><Cpu size={17}/></div>
        <div className="telemetry-hw-row"><div><b>GPU utilization</b><span>{gpu?.id||'GPU sensor unavailable'}</span></div><strong>{gpu?.utilization_percent===undefined?'—':gpu.utilization_percent+'%'}</strong></div>
        <div className="telemetry-hw-row"><div><b>VRAM usage</b><span>{gib(gpu?.vram_used_bytes)} / {gib(gpu?.vram_total_bytes)}</span></div><strong>{vram===null?'—':vram.toFixed(0)+'%'}</strong></div>
        <div className="telemetry-gauge"><div style={{width:(vram??0)+'%'}}/></div>
        <div className="telemetry-hw-row"><div><b>CPU utilization</b><span>Linux kernel sample</span></div><strong>{cpu?.utilization_percent===undefined?'—':cpu.utilization_percent.toFixed(1)+'%'}</strong></div>
        <div className="telemetry-hw-row"><div><b>Container memory</b><span>{gib(memory?.used_bytes)} / {gib(memory?.limit_bytes)}</span></div><strong>{percent(memory?.used_bytes,memory?.limit_bytes)===null?'—':percent(memory?.used_bytes,memory?.limit_bytes)!.toFixed(0)+'%'}</strong></div>
        <div className="telemetry-hw-foot"><HardDrive size={15}/>{hasGpu?'GPU counters: '+(snapshot.resources?.gpu?.scope||'driver'):'No GPU driver telemetry exposed to YAG'}</div>
      </div>
    </div>
  </section>
}
