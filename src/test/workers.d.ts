// App tests import connector code (connector/src), which is typed for Cloudflare Workers.
// Only the type name is needed here; the connector's own tsconfig uses the real Workers types.
interface KVNamespace {}
