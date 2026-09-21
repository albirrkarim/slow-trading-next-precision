/**
 * Bootstrap server-side process tasks when the standalone Next.js server starts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  // PROD:RUNNER_BOOTSTRAP_ON_SERVER_START
  // PROD:RUNTIME_MEMORY_MONITOR
  const [{ default: production }, { default: resourceMonitor }] =
    await Promise.all([
      import("@/lib/production"),
      import("@/lib/runtime/resource-monitor"),
    ]);
  const runtime = production.runtime.get();
  void runtime.start(production.factory.create()).catch((error) => {
    console.error("[Precision Runtime] stopped unexpectedly", error);
  });
  // PROD:INSTANCE_IP_CHECK_ON_START
  await (await import("@/lib/runtime/instance-ip")).default.lifecycle.check();
  resourceMonitor.lifecycle.start();
}
