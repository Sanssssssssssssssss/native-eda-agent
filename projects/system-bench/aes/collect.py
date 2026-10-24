"""Collect already completed local runs; never manufacture a pass from exit 0."""
import hashlib,json,pathlib,re
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
manifest=json.loads((HERE/'manifest.json').read_text())
sim=json.loads((HERE/'latest-sim.json').read_text())
impl=json.loads((HERE/'latest-impl.json').read_text())
negative=json.loads((HERE/'latest-negative.json').read_text())
simlog=(pathlib.Path(sim['artifact_directory'])/'process.log').read_text(errors='replace')
metrics_match=re.search(r'AES_METRICS ([^\r\n]+)',simlog)
metrics={k:int(v) for k,v in re.findall(r'(\w+)=(\d+)',metrics_match.group(1))} if metrics_match else {}
buildpath=pathlib.Path(impl['artifact_directory'])/'build-result.json' if impl['artifact_directory'] else None
ppa=json.loads(buildpath.read_text()) if buildpath and buildpath.exists() else None
if ppa:
    utilization=(buildpath.parent/'utilization.rpt').read_text(errors='replace')
    route=(buildpath.parent/'route-status.rpt').read_text(errors='replace')
    ppa['slice_luts_used']=int(re.search(r'\| Slice LUTs\s+\|\s+(\d+)',utilization).group(1))
    ppa['fully_routed_nets']=int(re.search(r'# of fully routed nets\.+\s*:\s*(\d+)',route).group(1))
    ppa['routing_errors']=int(re.search(r'# of nets with routing errors\.+\s*:\s*(\d+)',route).group(1))
    ppa['drc_warning_rules']=['CFGBVS-1','RTSTAT-10']
sources_unchanged=all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==sha for p,sha in manifest['source_sha256'].items())
result={'project':'aes','functional_pass':sim['pass'],'blocks_compared':manifest['blocks'],
    'independent_oracle':manifest['oracle'],'key_groups':len(manifest['groups']),
    'known_answer_block_operations':20,'random_block_operations':512,'reset_scenarios':4,
    'checker_negative_control_pass':negative['correctly_rejected'],
    'implementation_pass':impl['pass'],'ppa':ppa,'metrics':metrics,
    'source_commit':manifest['commit'],'source_license':manifest['license'],
    'synthesized_modules':manifest['synthesized_module_definitions'],
    'synthesized_source_lines_including_comments':manifest['synthesized_source_lines'],
    'synthesized_noncomment_nonblank_lines':manifest['synthesized_noncomment_nonblank_lines'],
    'sources_match_manifest':sources_unchanged,
    'sim':sim,'negative':negative,'implementation':impl,
    'limitations':['AES-128/256 block primitive only; no AES-192 or authenticated modes',
       'OOC timing at 100 MHz does not establish board timing or physical IO constraints; HD.PARTPIN_LOCS absent',
       'No board run, side-channel verification, formal proof, or external benchmark ranking'],
    'other_model_api_calls':0}
(HERE/'result.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
