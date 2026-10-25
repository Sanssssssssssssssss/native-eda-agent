// Acceptance for evaluation evidence. No EDA or provider execution occurs here.
export const lifecycleCoverage = Object.freeze({isolation:1,guidance:1,recovery:2,budget:1,ownership:1,integrity:3,delivery:1,dispatch:1,context:1});

export function assessLifecycleTap(text,exitCode) {
  const issues=[], rows=[...text.matchAll(/^(ok|not ok) (\d+) - ([^\r\n]+)/gm)];
  const scenarios=rows.map(([,status,number,title])=>{
    const directive=title.match(/\s+#\s*(SKIP|TODO)\b/i)?.[1]?.toLowerCase();
    const match=title.replace(/\s+#\s*(?:SKIP|TODO)\b.*/i,'').match(/^([^:]+): (.+)$/);
    return {number:Number(number),category:match?.[1]||'unclassified',name:match?.[2]||title,passed:status==='ok'&&!directive,...(directive?{directive}:{})};
  });
  const summary=name=>{
    const values=[...text.matchAll(new RegExp(`^# ${name} (\\d+)\\r?$`,'gm'))];
    return values.length===1?Number(values[0][1]):null;
  };
  const plans=[...text.matchAll(/^1\.\.(\d+)\r?$/gm)],expected=Object.values(lifecycleCoverage).reduce((a,b)=>a+b,0);
  if(exitCode!==0)issues.push('runner_failed');
  if(plans.length!==1||Number(plans[0][1])!==expected||summary('tests')!==expected||scenarios.length!==expected)issues.push('incomplete_scenario_inventory');
  if(summary('pass')!==expected||summary('fail')!==0||summary('cancelled')!==0||summary('skipped')!==0||summary('todo')!==0)issues.push('incomplete_or_nonpassing_summary');
  if(scenarios.some((row,i)=>row.number!==i+1)||new Set(scenarios.map(row=>`${row.category}:${row.name}`)).size!==scenarios.length)issues.push('duplicate_or_unordered_scenarios');
  const categories=Object.fromEntries([...new Set([...Object.keys(lifecycleCoverage),...scenarios.map(row=>row.category)])]
    .map(category=>[category,{total:scenarios.filter(row=>row.category===category).length,passed:scenarios.filter(row=>row.category===category&&row.passed).length}]));
  for(const [category,counts]of Object.entries(categories))if(counts.total!==lifecycleCoverage[category]||counts.passed!==counts.total)issues.push(`coverage_not_met:${category}`);
  return {status:issues.length?'failed':'passed',scenarios,metrics:{total:scenarios.length,passed:scenarios.filter(row=>row.passed).length,categories},issues};
}

export function sessionExecutionEligibility(manifest,events=[]) {
  const provenance=manifest.execution_provenance;
  if(provenance?.schema_version!==1||provenance.session_factory!=='builtin_pi_sdk')
    return {eligible:false,reason:provenance?.session_factory==='injected'?'injected_session_not_live':'session_execution_origin_unknown'};
  const start=events.find(row=>row.type==='run_start'),prompt=events.findIndex(row=>row.type==='prompt_start');
  if(start?.execution_provenance?.session_factory!==provenance.session_factory||prompt<0)
    return {eligible:false,reason:'session_execution_events_missing'};
  const messages=events.slice(prompt+1).filter(row=>row.type==='message_end'&&row.message?.role==='assistant');
  const successful=messages.filter(row=>['stop','length','toolUse'].includes(row.message.stopReason)).length;
  if(!manifest.provider||!manifest.model||successful<1||manifest.provider_observation?.successful_assistant_messages!==successful||manifest.provider_observation?.assistant_messages!==messages.length)
    return {eligible:false,reason:'provider_response_evidence_missing_or_inconsistent'};
  return {eligible:true,reason:'builtin_session_with_observed_responses',successful_assistant_messages:successful,
    scope:'Host factory and SDK event provenance; not independent provider billing verification.'};
}
