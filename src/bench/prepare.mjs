import fs from 'node:fs';
import path from 'node:path';
import { checkedPath } from './catalog.mjs';
import { generateRtl } from './generators.mjs';

export function sourceFiles(root, item) {
  const input = item.input;
  let files = [];
  if (input.kind === 'tool') files = [...(input.args.sources || []), input.args.script, input.args.netlist].filter(Boolean);
  else if (['call_file', 'node_test', 'timeout_fixture'].includes(input.kind)) {
    files = [input.path];
    if (input.kind === 'call_file' && fs.existsSync(checkedPath(root, input.path))) {
      const args = JSON.parse(fs.readFileSync(checkedPath(root, input.path), 'utf8'));
      files.push(...(args.sources || []), ...[args.script, args.netlist].filter(Boolean));
    }
  } else if (input.kind === 'verilogeval') files = [`${input.project}/selection.json`, `${input.project}/solutions/${input.task}.sv`, ...['prompt.txt', 'ref.sv', 'test.sv'].map(suffix => `vendor/verilog-eval/dataset_spec-to-rtl/${input.task}_${suffix}`)];
  else if (input.kind === 'fft') files = [`projects/fft-spectrum/${input.stage === 'simulation' ? 'simulate' : 'implement'}.tcl`, 'projects/fft-spectrum/create-ip.tcl', 'projects/fft-spectrum/rtl/spectrum_core.v', 'projects/fft-spectrum/tb_spectrum.sv', 'projects/fft-spectrum/oracle.py', 'projects/fft-spectrum/vectors/input.hex', 'projects/fft-spectrum/vectors/manifest.json', 'vendor/SynthPilot_Tutorial/prj/04/rtl/magnitude_calc.v'];
  return files.map(file => checkedPath(root, file));
}

export function preflight(root, item) {
  if (item.availability !== 'runnable') return { runnable: false, reason: item.note || item.availability, missing: [] };
  try {
    const missing = sourceFiles(root, item).filter(file => !fs.existsSync(file));
    return { runnable: missing.length === 0, reason: missing.length ? 'Required local inputs are missing.' : null, missing };
  } catch (error) { return { runnable: false, reason: String(error), missing: [] }; }
}

export function prepareCase(root, item, directory, seed) {
  fs.mkdirSync(directory, { recursive: true });
  const input = item.input;
  const files = sourceFiles(root, item);
  const write = (name, bytes) => { const file = path.join(directory, name); fs.writeFileSync(file, bytes); files.push(file); return file; };
  let args, adaptation = null;
  if (input.kind === 'tool') args = structuredClone(input.args);
  else if (input.kind === 'call_file') args = JSON.parse(fs.readFileSync(checkedPath(root, input.path), 'utf8'));
  else if (input.kind === 'generated') {
    const generated = generateRtl({ family: input.generator, width: input.width, samples: input.samples, seed });
    args = { sources: [write('dut.sv', generated.rtl), write('tb.sv', generated.testbench)], top: 'tb_benchmark' };
    write('oracle.json', JSON.stringify(generated.oracle, null, 2) + '\n');
  } else if (input.kind === 'invalid_rtl') {
    args = { sources: [write('invalid.v', 'module intentionally_invalid(output x); assign x = ; endmodule\n')], top: 'intentionally_invalid' };
  } else if (input.kind === 'verilogeval') {
    const source = path.join(root, 'vendor/verilog-eval/dataset_spec-to-rtl');
    const raw = fs.readFileSync(path.join(source, `${input.task}_test.sv`), 'utf8');
    const declarations = /\s*wire tb_match;[^\n]*\n\s*wire tb_mismatch = ~tb_match;[^\n]*/;
    if (!declarations.test(raw) || !raw.includes('module tb();')) throw new Error(`Unexpected upstream VerilogEval format: ${input.task}`);
    const adapted = raw.replace(declarations, '').replace('module tb();', 'module tb();\nwire tb_match;\nwire tb_mismatch = ~tb_match;').replace(/\$dump(?:vars|file)\([^;]*\);/g, '');
    args = { sources: [write('test.sv', adapted), write('reference.sv', '`timescale 1ps/1ps\n' + fs.readFileSync(path.join(source, `${input.task}_ref.sv`), 'utf8') + '\n`default_nettype wire\n'), write('solution.sv', fs.readFileSync(path.join(root, input.project, 'solutions', `${input.task}.sv`)))], top: 'tb' };
    adaptation = 'Declaration ordering for XSim; reference directive isolation; waveform statements removed. Upstream watchdog unchanged.';
  } else if (input.kind === 'fft') {
    const original = fs.readFileSync(files[0], 'utf8');
    const pointer = /^set f \[open \[file join \$design latest-(?:simulation|implementation)\.txt\] w\]\r?\nputs \$f \$out\r?\nclose \$f\r?\n/gm;
    if ((original.match(pointer) || []).length !== 1) throw new Error('FFT pointer adapter requires exactly one recognized latest write block.');
    const adapted = original.replace(pointer, '').replace(/^log_wave[^\r\n]*\r?\n/gm, '');
    if (/latest-(?:simulation|implementation)\.txt/.test(adapted)) throw new Error('FFT latest pointer survived isolation.');
    args = { script: write('isolated-fft.tcl', adapted) };
    adaptation = 'Original Tcl retained in snapshots; run-local script removes latest pointer writes and explicit log_wave commands.';
  } else if (['node_test', 'timeout_fixture'].includes(input.kind)) args = { script: checkedPath(root, input.path) };
  else throw new Error(`Input kind cannot run: ${input.kind}`);
  if (item.tool === 'eda_xsim') args.capture_top_wave = false;
  write('arguments.json', JSON.stringify(args, null, 2) + '\n');
  const candidateFiles = item.tool === 'eda_xsim'
    ? (args.sources || []).filter(file => !/^(?:tb(?:_|\.)|test\.|reference\.)/i.test(path.basename(file))).map(file => checkedPath(root, file))
    : input.kind === 'fft' ? files.filter(file => /(?:spectrum_core|magnitude_calc)\.v$/.test(file))
    : item.tool === 'eda_ltspice_batch' ? [checkedPath(root, args.netlist)] : [];
  if (input.kind === 'verilogeval') candidateFiles.push(checkedPath(root, `${input.project}/solutions/${input.task}.sv`));
  return { args, files: [...new Set(files)], candidateFiles, adaptation };
}
