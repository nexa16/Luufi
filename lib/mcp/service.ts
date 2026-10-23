import {
  callReleaseTool,
  releaseTools,
  isReleaseTool,
  validReleaseArguments,
} from './releases';
import {
  callExecutionTool,
  executionTools,
  isExecutionTool,
  validExecutionArguments,
} from './execution';
import {
  callMediaTool,
  mediaTools,
  isMediaTool,
  validMediaArguments,
} from './media';
import {
  callFeedbackTool,
  feedbackTools,
  isFeedbackTool,
  validFeedbackArguments,
} from './feedback';
import {
  callIdeaTool,
  ideaTools,
  isIdeaTool,
  validIdeaArguments,
} from './ideas';
import {
  callPlanningTool,
  isPlanningTool,
  planningTools,
  validPlanningArguments,
} from './planning';

export interface ProbeState {
  revision: number;
  value: string;
}

export interface McpDependencies {
  environment: string;
  ownerId: string;
  getContext: () => Promise<unknown>;
  readProbe: () => Promise<ProbeState | null>;
  writeProbe: (input: {
    expectedRevision: number;
    value: string;
    requestKey: string;
  }) => Promise<ProbeState & { replayed: boolean }>;
  getGuideline: (id: string) => Promise<{
    id: string;
    version: string;
    content: string;
    sha256: string;
  }>;
}

const protocolVersion = '2026-07-28';
const guidelineIds = [
  'documentation',
  'planning',
  'implementation',
  'data-access',
] as const;

const emptySchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

const tools = [
  {
    name: 'get_context',
    description:
      'Liest Umgebung, Quellbranch, vollständigen Commit-SHA und Datenbereitschaft.',
    inputSchema: emptySchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'probe_read',
    description: 'Liest ausschließlich den isolierten MCP-Testdatensatz.',
    inputSchema: emptySchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'probe_write',
    description:
      'Ändert den isolierten Testdatensatz mit Revision und Wiederholungsschlüssel.',
    inputSchema: {
      type: 'object',
      properties: {
        expectedRevision: { type: 'integer', minimum: 0 },
        value: { type: 'string', maxLength: 1000 },
        requestKey: { type: 'string', minLength: 1, maxLength: 100 },
      },
      required: ['expectedRevision', 'value', 'requestKey'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_guidelines',
    description: 'Liefert eine zentrale Richtlinie mit Version und SHA-256.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', enum: guidelineIds } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'read_probe_attachment',
    description:
      'Liefert die vollständige synthetische Testdatei als Base64 samt SHA-256.',
    inputSchema: emptySchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ...ideaTools,
  ...planningTools,
  ...feedbackTools,
  ...mediaTools,
  ...executionTools,
  ...releaseTools,
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function stringLength(value: unknown): number {
  return typeof value === 'string' ? Array.from(value).length : -1;
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function success(id: unknown, result: Record<string, unknown>) {
  return { jsonrpc: '2.0', id, result: { resultType: 'complete', ...result } };
}

function toolResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function toolError(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function safeFailure(error: unknown) {
  if (record(error)) {
    if (error.code === 'REVISION_CONFLICT') {
      return toolError('Versionskonflikt. Testdatensatz neu laden.');
    }
    if (error.code === 'REQUEST_KEY_CONFLICT') {
      return toolError(
        'Wiederholungsschlüssel gehört zu einem anderen Inhalt.',
      );
    }
  }
  return toolError('Werkzeug konnte nicht ausgeführt werden.');
}

function validArguments(name: string, args: Record<string, unknown>): boolean {
  if (isIdeaTool(name)) return validIdeaArguments(name, args);
  if (isPlanningTool(name)) return validPlanningArguments(name, args);
  if (isFeedbackTool(name)) return validFeedbackArguments(name, args);
  if (isMediaTool(name)) return validMediaArguments(name, args);
  if (isExecutionTool(name)) return validExecutionArguments(name, args);
  if (isReleaseTool(name)) return validReleaseArguments(name, args);
  switch (name) {
    case 'get_context':
    case 'probe_read':
    case 'read_probe_attachment':
      return onlyKeys(args, []);
    case 'probe_write':
      return (
        onlyKeys(args, ['expectedRevision', 'value', 'requestKey']) &&
        nonnegativeInteger(args.expectedRevision) &&
        stringLength(args.value) >= 0 &&
        stringLength(args.value) <= 1000 &&
        stringLength(args.requestKey) >= 1 &&
        stringLength(args.requestKey) <= 100
      );
    case 'get_guidelines':
      return (
        onlyKeys(args, ['id']) &&
        typeof args.id === 'string' &&
        guidelineIds.some((id) => id === args.id)
      );
    default:
      return false;
  }
}

async function attachment() {
  const text = 'Luufi MCP proof attachment.\nNo personal data.\n';
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return {
    filename: 'luufi-mcp-proof.txt',
    mimeType: 'text/plain',
    byteLength: bytes.byteLength,
    sha256,
    base64: btoa(text),
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  deps: McpDependencies,
) {
  if (!deps.ownerId.trim()) return toolError('Zugriff nicht erlaubt.');
  try {
    if (isIdeaTool(name)) return await callIdeaTool(name, args, deps.ownerId);
    if (isPlanningTool(name))
      return await callPlanningTool(name, args, deps.ownerId);
    if (isFeedbackTool(name))
      return await callFeedbackTool(name, args, deps.ownerId);
    if (isMediaTool(name)) return await callMediaTool(name, args, deps.ownerId);
    if (isExecutionTool(name))
      return await callExecutionTool(name, args, deps.ownerId);
    if (isReleaseTool(name))
      return await callReleaseTool(name, args, deps.ownerId);
    switch (name) {
      case 'get_context':
        return toolResult(await deps.getContext());
      case 'probe_read':
        return toolResult(await deps.readProbe());
      case 'probe_write':
        return toolResult(
          await deps.writeProbe({
            expectedRevision: args.expectedRevision as number,
            value: args.value as string,
            requestKey: args.requestKey as string,
          }),
        );
      case 'get_guidelines':
        return toolResult(await deps.getGuideline(args.id as string));
      case 'read_probe_attachment':
        return toolResult(await attachment());
      default:
        return toolError('Unbekanntes Werkzeug.');
    }
  } catch (error) {
    return safeFailure(error);
  }
}

/** JSON-RPC domain boundary. The HTTP adapter authenticates the Sites caller. */
export async function handleMcpMessage(
  message: unknown,
  deps: McpDependencies,
): Promise<unknown> {
  if (!record(message)) {
    return rpcError(null, -32600, 'Ungültige JSON-RPC-Anfrage.');
  }
  const validId =
    typeof message.id === 'string' ||
    (typeof message.id === 'number' && Number.isSafeInteger(message.id));
  const id = validId ? message.id : null;
  if (
    message.jsonrpc !== '2.0' ||
    typeof message.method !== 'string' ||
    (!validId && 'id' in message) ||
    !onlyKeys(message, ['jsonrpc', 'id', 'method', 'params'])
  ) {
    return rpcError(id, -32600, 'Ungültige JSON-RPC-Anfrage.');
  }
  if (message.method === 'notifications/initialized' && !('id' in message)) {
    return null;
  }
  // Notifications must never cause writes or return JSON-RPC responses.
  if (!('id' in message)) return null;
  if (message.params !== undefined && !record(message.params)) {
    return rpcError(id, -32602, 'Ungültige Parameter.');
  }
  const params = record(message.params) ? message.params : {};
  const availableTools = tools.filter(
    (tool) =>
      deps.environment === 'preview' ||
      ['get_guidelines', 'get_context'].includes(tool.name) ||
      isIdeaTool(tool.name) ||
      isPlanningTool(tool.name) ||
      isFeedbackTool(tool.name) ||
      isMediaTool(tool.name) ||
      isExecutionTool(tool.name) ||
      isReleaseTool(tool.name),
  );
  switch (message.method) {
    case 'server/discover':
      return success(id, {
        supportedVersions: [protocolVersion],
        capabilities: { tools: {} },
        serverInfo: { name: 'luufi', version: '1.0.0' },
      });
    case 'initialize':
      return success(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'luufi', version: '1.0.0' },
      });
    case 'tools/list':
      return success(id, { tools: availableTools });
    case 'tools/call': {
      if (
        !onlyKeys(params, ['name', 'arguments', '_meta']) ||
        typeof params.name !== 'string' ||
        (params.arguments !== undefined && !record(params.arguments)) ||
        (params._meta !== undefined && !record(params._meta))
      ) {
        return rpcError(id, -32602, 'Ungültige Werkzeugparameter.');
      }
      if (!availableTools.some((tool) => tool.name === params.name)) {
        return success(id, toolError('Unbekanntes Werkzeug.'));
      }
      // MCP metadata belongs to the protocol envelope, never tool input or identity.
      // Arguments may be omitted for tools with an empty input schema.
      const args = record(params.arguments) ? params.arguments : {};
      if (!validArguments(params.name, args)) {
        return success(
          id,
          toolError(
            isIdeaTool(params.name) ||
              isPlanningTool(params.name) ||
              isFeedbackTool(params.name) ||
              isMediaTool(params.name) ||
              isExecutionTool(params.name) ||
              isReleaseTool(params.name)
              ? JSON.stringify({
                  code: 'validation',
                  error: isReleaseTool(params.name)
                      ? 'Ungültige Versions-Werkzeugargumente.'
                      : isExecutionTool(params.name)
                        ? 'Ungültige Ausführungs-Werkzeugargumente.'
                        : isFeedbackTool(params.name) ||
                            isMediaTool(params.name)
                          ? 'Ungültige Feedback-Werkzeugargumente.'
                          : isPlanningTool(params.name)
                            ? 'Ungültige Planungs-Werkzeugargumente.'
                            : 'Ungültige Projektideen-Werkzeugargumente.',
                })
              : 'Ungültige Werkzeugargumente.',
          ),
        );
      }
      return success(id, await callTool(params.name, args, deps));
    }
    default:
      return rpcError(id, -32601, 'Unbekannte Methode.');
  }
}
