/**
 * Bootstrap server-side process tasks when the standalone Next.js server starts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  // PROD:RUNNER_BOOTSTRAP_ON_SERVER_START
  // PROD:RUNTIME_MEMORY_MONITOR
  const [
    { default: production },
    { default: resourceMonitor },
    { systemNotif },
    { systemNotifDelivery },
    { runtimeStorage, runtimeInstanceIp },
  ] = await Promise.all([
    import("@/lib/production"),
    import("@/lib/system/runtime/resource-monitor"),
    import("@/lib/system/notification"),
    import("@/lib/system/notification/delivery"),
    import("@/lib/system/storage"),
  ]);
  // The app composition root wires the real notification delivery into the
  // system port so authoritative roots stay notification-implementation-free.
  systemNotif.register((payload) => systemNotifDelivery.central(payload));
  // Seed the persistent catalog on first boot; throws on a partial catalog.
  await runtimeStorage.catalog.ensure();
  const runtime = production.runtime.get();
  void runtime.start(production.factory.create()).catch((error) => {
    console.error("[Precision Runtime] stopped unexpectedly", error);
  });
  // PROD:INSTANCE_IP_CHECK_ON_START
  await runtimeInstanceIp.lifecycle.check();
  resourceMonitor.lifecycle.start();
}
