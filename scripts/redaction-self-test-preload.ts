/**
 * Negative control for `scripts/check-output-redaction.ts --self-test server`. Loaded into the
 * server process with `bun --preload`, it deliberately writes two synthetic markers to that
 * process's own output (one to stdout as it starts, one to stderr a few seconds later, while the
 * check is running). The check must find both and fail on them; if it doesn't, it can't see server
 * output. Never loaded otherwise.
 */
const out = process.env["ZPMARK_SELF_TEST_STDOUT"];
const err = process.env["ZPMARK_SELF_TEST_STDERR"];
if (out) console.log(`self-test ${out}`);
if (err) setTimeout(() => console.error(`self-test ${err}`), 5000).unref();
