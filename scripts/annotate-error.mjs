// Turns the end of a failed command's output into a GitHub Actions error annotation, which shows
// on the run's summary page (and in the API) without opening the logs.
//   some-command 2>&1 | node scripts/annotate-error.mjs "Title"

const title = process.argv[2] || 'Error';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const tail = input.replace(/\r/g, '').split('\n').filter((l) => l.trim()).slice(-15).join('\n').slice(-3000);
const escape = (s) => s.replace(/%/g, '%25').replace(/\n/g, '%0A');
console.log(`::error title=${escape(title).replace(/[:,]/g, ' ')}::${escape(tail || 'no output')}`);
