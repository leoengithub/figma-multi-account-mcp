import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';

import type { AccountRegistry } from './registry/index.js';
import type { AccountPool } from './pool/index.js';
import type { ProxyRouter } from './proxy/index.js';
import { injectAccountParamIntoTools } from './proxy/schema-injector.js';
import { sanitizeUpstreamPayload } from './utils/sanitize.js';

export async function startProxyServer(opts: {
  logger: Logger;
  registry: AccountRegistry;
  pool: AccountPool;
  router: ProxyRouter;
}): Promise<void> {
  const { logger, registry, pool, router } = opts;

  const server = new Server(
    { name: 'figma-multi-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // Discover tools from first healthy upstream instance.
  const { client } = await pool.getHealthyClientForDiscovery();
  const upstreamTools = await client.listTools();
  const injectedTools = injectAccountParamIntoTools({
    toolList: upstreamTools.tools,
    accountNames: registry.listAccountNames(),
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const res: ListToolsResult = {
      tools: sanitizeUpstreamPayload(injectedTools),
    } as any;
    return res;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const result = await router.routeToolCall(name, args, extra);
    return result as any;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('figma-multi-mcp connected over stdio');
}

