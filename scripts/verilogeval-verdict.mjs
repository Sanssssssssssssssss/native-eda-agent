export function verdict(transcript) {
  const match = transcript.match(/Mismatches:\s*(\d+)\s+in\s+(\d+)\s+samples/);
  const mismatches = match ? Number(match[1]) : null;
  const samples = match ? Number(match[2]) : 0;
  const timed_out = /\bTIMEOUT\b/.test(transcript);
  return { mismatches, samples, timed_out,
    passed: !!match && mismatches === 0 && samples > 0 && !timed_out && !/Fatal:|FATAL_ERROR/.test(transcript) };
}
