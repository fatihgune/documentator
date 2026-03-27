import { runPipeline } from "./runner.js";

const kbDir = process.cwd();
const forceFullRediscover = process.env.FORCE_FULL_REDISCOVER === "true";

console.log("Documentator nightly pipeline starting...");
console.log(`Knowledge base: ${kbDir}`);
console.log(`Force full re-discover: ${forceFullRediscover}`);

try {
  const summary = await runPipeline(kbDir, forceFullRediscover);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.services_failed.length > 0) {
    process.exit(1); // Non-zero exit for CI visibility, even if partial success
  }
} catch (err) {
  console.error("Pipeline failed:", err);
  process.exit(2);
}
