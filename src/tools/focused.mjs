// Task-specific contracts over shared executors. These are not additional EDA engines.
export const fpgaSurfaces = [
  ...['parts', 'ips', 'commands'].map(kind => ({ name: `eda_vivado_find_${kind}`, base: 'eda_vivado_catalog', fixed: { kind }, fields: ['pattern','limit'], required: [], purpose: `Find installed ${kind}; starts Vivado, returns bounded matches.` })),
  ...['timing','utilization','cdc','drc','methodology','clocks','exceptions','route'].map(report => ({ name: `eda_vivado_report_${report}`, base: 'eda_vivado_reports', fixed: { reports: [report] }, fields: ['checkpoint'], required: ['checkpoint'], purpose: `Generate ${report} evidence from an immutable input DCP in a fresh run. Report warnings require review.` })),
  ...['cells','nets','ports','pins','clocks'].map(kind => ({ name: `eda_vivado_query_${kind}`, base: 'eda_vivado_objects', fixed: { kind }, fields: ['checkpoint','pattern','limit'], required: ['checkpoint'], purpose: `Query ${kind} with bounded output and total count. Patterns are Tcl data.` })),
  ...[['setup','max'],['hold','min']].map(([kind,delay_type]) => ({ name: `eda_vivado_${kind}_paths`, base: 'eda_vivado_timing_paths', fixed: { delay_type }, fields: ['checkpoint','from_clock','to_clock','limit'], required: ['checkpoint'], purpose: `Inspect worst ${kind} paths. This is not whole-design signoff.` })),
];

export const platformSurfaces = [
  ...[['inspect','inspect'],['export','export'],['recovery_check','recovery-check']].map(([suffix,action]) => ({name:`eda_trace_${suffix}`,base:'eda_trace',fixed:{action},fields:['directory'],required:['directory'],purpose: action==='export'?'Export terminal spans to a local OTLP JSON file; no upload.':action==='inspect'?'Inspect hashes, span lineage and terminal evidence; no EDA execution.':'Check durable optimizer recovery eligibility and process ownership; does not resume.'})),
  {name:'eda_runs_list',base:'eda_runs',fixed:{action:'list'},fields:['limit'],required:[],purpose:'Read persistent run states and counts.'},
  {name:'eda_runs_reconcile',base:'eda_runs',fixed:{action:'reconcile'},fields:[],required:[],purpose:'Release stale leases only after owner and child processes are absent; never terminate a process.'},
  ...['list','plan','run','report','compare'].map(action => ({name:`eda_benchmark_${action}`,base:'eda_benchmark',fixed:{action},
    fields: action==='report'?['directory']:action==='compare'?['baseline','candidate']:['category','tier','tool','ids','seed',...(action==='run'?['concurrency']:[])],
    required:action==='report'?['directory']:action==='compare'?['baseline','candidate']:[],
    purpose:{list:'List cases and execution prerequisites.',plan:'Resolve a frozen campaign without starting EDA.',run:'Execute a frozen campaign with shared leases and per-case receipts; starts EDA.',report:'Read a retained campaign; failures and timeouts remain in the denominator.',compare:'Compare campaigns only when case acceptance and test inputs are compatible.'}[action]})),
];
