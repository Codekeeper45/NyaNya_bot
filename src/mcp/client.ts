import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('mcp');

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface MCPConnection {
  client: Client;
  transport: StdioClientTransport;
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
}

class MCPManager {
  private connections = new Map<string, MCPConnection>();
  private serversConfig: ServerConfig[] = [];

  constructor() {
    try {
      const raw = readFileSync(join(__dirname, 'servers.json'), 'utf-8');
      this.serversConfig = (JSON.parse(raw) as { servers: ServerConfig[] }).servers;
    } catch (err) {
      log.warn({ err }, 'Failed to load MCP servers config');
    }
  }

  async connect(serverName: string): Promise<MCPConnection | null> {
    if (this.connections.has(serverName)) {
      return this.connections.get(serverName)!;
    }

    const serverDef = this.serversConfig.find(s => s.name === serverName);
    if (!serverDef) {
      log.warn({ serverName }, 'MCP server not found in config');
      return null;
    }

    // Resolve env vars
    const env: Record<string, string> = {};
    for (const [key, val] of Object.entries(serverDef.env ?? {})) {
      if (val.startsWith('${') && val.endsWith('}')) {
        const envKey = val.slice(2, -1);
        const envVal = process.env[envKey];
        if (!envVal) {
          log.warn({ serverName, envKey }, 'Missing env var for MCP server');
          return null;
        }
        env[key] = envVal;
      } else {
        env[key] = val;
      }
    }

    try {
      const transport = new StdioClientTransport({
        command: serverDef.command,
        args: serverDef.args,
        env: { ...process.env as Record<string, string>, ...env },
      });

      const client = new Client({ name: 'opekun', version: '1.0.0' });
      await client.connect(transport);

      const { tools } = await client.listTools();
      const conn: MCPConnection = { client, transport, tools };
      this.connections.set(serverName, conn);
      log.info({ serverName, toolCount: tools.length }, 'MCP server connected');
      return conn;
    } catch (err) {
      log.error({ err, serverName }, 'Failed to connect MCP server');
      return null;
    }
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>) {
    const conn = await this.connect(serverName);
    if (!conn) throw new Error(`MCP server "${serverName}" not connected`);
    return conn.client.callTool({ name: toolName, arguments: args });
  }

  async shutdown(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.client.close();
        log.info({ name }, 'MCP server disconnected');
      } catch (err) {
        log.error({ err, name }, 'Error disconnecting MCP server');
      }
    }
    this.connections.clear();
  }
}

export const mcpManager = new MCPManager();
