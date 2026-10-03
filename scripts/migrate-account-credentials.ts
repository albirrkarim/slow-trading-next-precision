/** One-off: re-save accounts.json so credentials persist encrypted. */
import runtimeCatalog from "../src/lib/system/storage/catalog";

async function main() {
  const accounts = await runtimeCatalog.accounts.list();
  const saved = await runtimeCatalog.accounts.save(accounts);
  console.log(`re-saved ${saved.length} accounts with encrypted credentials`);
}

void main();
