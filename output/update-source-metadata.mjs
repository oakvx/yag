import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
const path='src/data/repository.ts';
const source=readFileSync(path,'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {SOURCE_EXCERPTS}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const rows=SOURCE_EXCERPTS.map(({code,highlights,href,...entry})=>entry);
const update=(id,changes)=>Object.assign(rows.find(row=>row.id===id),changes);
update('main-c',{summary:'The complete host entrypoint loads configuration, installs SIGPIPE handling, initializes libcurl, runs the server and cleans up after it returns.',caveat:'Complete file, including original includes and whitespace.'});
update('yag-h',{summary:'A contiguous slice of yag_config shows the fixed-capacity key, route, replica and capability tables, plus transport limits and provider counters.',caveat:'Contiguous fields from yag_config. The remaining scheduler, managed-client and operator state is below this excerpt in the original header.'});
update('openai-upstream',{shortTitle:'Upstream Dispatch & Fallback',summary:'Exact-model routes take priority. Otherwise the default pool admits a primary or eligible replica. Dedicated models cannot fall back to the generic primary; resource saturation is separate from transport failure.',notes:['Pool admission is tracked even for a single primary, preventing live configuration changes from racing active requests.','Opt-in fallback only retries pre-response DNS/connect failures or route admission bypass. HTTP errors and ambiguous timeouts are never replayed.','Pool admission slots are released after upstream completion. Exclusive replicas cannot fall back to the generic primary.'],caveat:'Complete upstream_for_model() function. The lower-level 100 ms cancellation loop is in upstream_perform() in the same file.'});
update('responses-adapter',{summary:'The Responses parser checks its top-level allowlist and validates model, input, instructions, stream, metadata and stateless store settings before translation.',caveat:'Contiguous parser validation block. Tool translation and optional reasoning projections appear later in the same file.'});
update('anthropic-adapter',{shortTitle:'Bounded Thinking Translation',summary:'Thinking hints are validated and mapped to Chat reasoning_effort. Adaptive intent becomes medium and enabled intent becomes high; exact Anthropic thinking budgets are not reproduced.',notes:['Only type and budget_tokens are accepted in this object.','A disabled hint cannot carry a budget; adaptive cannot carry one either.','This mapping does not create native thinking blocks or guarantee model reasoning behavior.'],caveat:'Complete thinking_valid() function. The rest of the Messages adapter implements the bounded text and function-tool subset.'});
update('cmake-build',{summary:'The native C17 target links libcurl, POSIX threads and vendored yyjson. This excerpt shows the actual source list and compiler settings.',notes:['The target includes scheduler, GPU probes, managed clients, provider management and admin audit modules.','CTest registrations follow this target definition; registration is not proof of a successful test run.'],caveat:'Opening build definition. The complete file contains all conditional CTest registrations.'});
update('tests-contract',{summary:'A deterministic mock test checks the exact order of Anthropic SSE events and the text reconstructed from content deltas.',notes:['The assertions cover event order and the completed text for a local mock upstream.','Passing this test does not qualify a real inference model or every Claude Code tool workflow.'],caveat:'One complete test method from tests/anthropic.py.'});
rows.push(
 {id:'adaptive-scheduler',shortTitle:'Adaptive GPU Admission',path:'host/src/core/scheduler.c',lang:'c',category:'Control Plane',kindLabel:'Host C17 Source',summary:'When enabled, available GPU sensors adjust the admission ceiling using measured free VRAM, a safety margin and an operator-supplied per-request allowance.',notes:['Capacity never exceeds the configured maximum and keeps at least one slot.','Missing or invalid VRAM sensors retain the static cap. Samples are limited to once per second.','This is admission control, not a model-specific VRAM guarantee or a distributed GPU scheduler.'],caveat:'Complete refresh_adaptive_capacity() function. Per-replica VRAM reservations are a separate operator-estimated mechanism.',relatedRoute:'/architecture',relatedLabel:'Read the host architecture'},
 {id:'pool-admission',shortTitle:'Replica Resource Admission',path:'host/src/inference/openai.c',lang:'c',category:'Control Plane',kindLabel:'Host C17 Source',summary:'The pool filters replicas by model policy, cooldown and declared capacity before reserving the selected backend.',notes:['The pool supports up to eight replicas and exact declared model allowlists.','Per-run request limits count reservations, not money or successful generations.','Concurrency and VRAM reservations are held through the upstream request, including streaming.'],caveat:'Complete pool_choose_locked() function. Declared resource budgets do not measure another server’s free GPU memory.',relatedRoute:'/routing',relatedLabel:'Read routing and pool boundaries'},
 {id:'admin-audit',shortTitle:'Private Admin Event Audit',path:'host/src/core/admin_audit.c',lang:'c',category:'Control Plane',kindLabel:'Host C17 Source',summary:'An opt-in JSONL trail records fixed administrative route and method labels with HTTP status and time, without copying request bodies or identities.',notes:['The audit file must be enabled and validated during startup.','Prompts, keys, IP addresses and client labels do not enter this event trail.','An event records an attempted response, not proof that the remote peer received it.'],caveat:'Complete file. This is not tamper-evident identity auditing or persistent inference history.',relatedRoute:'/security',relatedLabel:'Review the security boundaries'}
);
let header=source.slice(0,source.indexOf('export type SourceCategory'));
header='import { PROJECT_SNAPSHOT } from "./project-snapshot.generated";\n'+header;
header=header.replace('`${REPO_URL}/blob/main`','`${REPO_URL}/blob/${PROJECT_SNAPSHOT.revision}`');
const types=`export type SourceCategory = "Entry & Structs" | "Listener & Auth" | "Routing & Transport" | "Protocol Adapters" | "Build & Tests" | "Control Plane";
export interface SourceExcerpt {
  id: string; shortTitle: string; path: string; href: string;
  lang: "c" | "python" | "cmake" | "bash" | "json";
  category: SourceCategory;
  kindLabel: "Host C17 Source" | "Header Definition" | "Build Definition" | "Mock Contract Test";
  summary: string; highlights: number[]; code: string; notes: string[]; caveat: string;
  relatedRoute: string; relatedLabel: string; startLine: number; endLine: number;
}
const SOURCE_METADATA: Array<Omit<SourceExcerpt, "href" | "code" | "highlights" | "startLine" | "endLine">> = `;
const footer=`;
export const SOURCE_EXCERPTS: SourceExcerpt[] = SOURCE_METADATA.map(entry => ({
  ...entry, ...PROJECT_SNAPSHOT.excerpts[entry.id as keyof typeof PROJECT_SNAPSHOT.excerpts], highlights: [],
}));
export function getExcerptById(id: string): SourceExcerpt {
  return SOURCE_EXCERPTS.find(entry => entry.id === id) ?? SOURCE_EXCERPTS[0];
}
`;
writeFileSync(path,(header+types+JSON.stringify(rows,null,2)+footer).replace(/\r?\n/g,'\r\n'));
