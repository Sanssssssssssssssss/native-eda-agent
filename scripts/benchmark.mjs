import { loadCatalog, validateCatalog, listCases, planBenchmark, runBenchmark, reportBenchmark, compareRuns } from '../src/bench/index.mjs';
const [command = 'help', ...argv] = process.argv.slice(2);
const options = {}, positional = [];
const abort = new AbortController(); process.on('SIGINT', () => abort.abort());
try {
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { positional.push(argv[i]); continue; }
    const key = argv[i].slice(2);
    if (!['category', 'tier', 'tool', 'ids', 'seed', 'concurrency'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Unknown option or missing value: ${argv[i]}`);
    options[key] = ['seed', 'concurrency'].includes(key) ? Number(argv[++i]) : argv[++i];
  }
  let result;
  if (command === 'validate') result = validateCatalog(loadCatalog());
  else if (command === 'list') {
    const listed = listCases(options);
    result = { ...listed, cases: listed.cases.map(({ id, family, variant, category, tier, tool, origin, availability, seed }) => ({ id, family, variant, category, tier, tool, origin, availability, seed })) };
  } else if (command === 'plan') result = planBenchmark(options);
  else if (command === 'run') {
    const run = await runBenchmark({ ...options, signal: abort.signal });
    result = { directory: run.directory, status: run.status, counts: run.counts, duration_ms: run.duration_ms, case_count: run.case_count, family_count: run.family_count, model_api_calls: run.model_api_calls };
    if (run.status !== 'completed') process.exitCode = 1;
  } else if (command === 'report') {
    if (positional.length !== 1) throw new Error('report requires RUN_DIRECTORY');
    const report = reportBenchmark(positional[0]); console.log(report.markdown); result = null;
  } else if (command === 'compare') {
    if (positional.length !== 2) throw new Error('compare requires BASELINE_DIRECTORY CANDIDATE_DIRECTORY');
    result = compareRuns(...positional);
  } else if (command === 'help') {
    console.log('benchmark.mjs validate|list|plan|run [--category C] [--tier smoke|light|system|implementation|external] [--tool T] [--ids a,b] [--seed N] [--concurrency 1..4]\nbenchmark.mjs report RUN_DIRECTORY\nbenchmark.mjs compare BASELINE_DIRECTORY CANDIDATE_DIRECTORY\nDefault plan/run selects the smoke tier. No model APIs; waveform logging is not requested.');
  } else throw new Error(`Unknown command: ${command}`);
  if (result) console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(String(error)); process.exitCode = 1; }
