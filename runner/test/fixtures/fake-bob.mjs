// Fake Bob Shell for runner tests: mimics `bob --version` and `bob run --format json`.
const argv = process.argv.slice(2);
if (argv[0] === '--version') {
  console.log('0.0.0-fake');
  process.exit(0);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  if (input.includes('SLEEP')) {
    setTimeout(() => {}, 60_000);
    return;
  }
  if (input.includes('NOLICENSE')) {
    console.error('Error: A license agreement is required. Please accept the license terms before proceeding.');
    console.error('view license with &#x60;bob --show-license&#x60; and accept with &#x60;--accept-license&#x60;.');
    process.exit(1);
  }
  if (input.includes('GARBAGE')) {
    console.log('not json at all');
    process.exit(1);
  }
  console.log('[info] fake bob starting');
  console.log(JSON.stringify({
    type: 'result',
    timestamp: new Date().toISOString(),
    status: 'success',
    stats: { task_id: 't-1', total_tokens: 30, input_tokens: 20, output_tokens: 10, duration_ms: 5, session_costs: 0.1, tool_calls: 2 },
    last_message: JSON.stringify({
      argv,
      prompt: input,
      github_token_seen: process.env.GITHUB_TOKEN !== undefined,
      bob_key_seen: process.env.BOB_API_KEY !== undefined,
    }),
  }));
});
