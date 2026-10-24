"""Generate explicit native-tool invocations and a common OOC implementation flow."""
import json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
HERE=pathlib.Path(__file__).resolve().parent
def prepare(name,top,sources):
    d=HERE/name;d.mkdir(exist_ok=True)
    sim={'sources':sources+[f'projects/system-bench/{name}/tb_{name}.sv'],'top':f'tb_{name}','capture_top_wave':True}
    (d/'sim.json').write_text(json.dumps(sim,indent=2))
    (d/'impl.json').write_text(json.dumps({'script':f'projects/system-bench/{name}/implement.tcl'}))
    (d/'sources.json').write_text(json.dumps({'top':top,'sources':sources},indent=2))
    src='\n'.join('read_verilog -sv [file join $root '+p.replace('/', ' ')+']' for p in sources)
    (d/'implement.tcl').write_text('set root $::env(EDA_WORKSPACE)\nset_param general.maxThreads 2\n'+src+f'\nset top {top}\nsource [file join $root projects system-bench implement-common.tcl]\n')
if __name__=='__main__':
    prepare('soc','soc_top',['vendor/picorv32/picorv32.v','projects/system-bench/soc/soc_top.v'])
