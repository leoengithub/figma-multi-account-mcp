import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

export function injectAccountParamIntoTools(opts: {
  toolList: ListToolsResult['tools'];
  accountNames: string[];
}): ListToolsResult['tools'] {
  const { toolList, accountNames } = opts;

  const accountSchema = {
    type: 'string',
    enum: accountNames,
    description:
      `Figma account to use. Available: ${accountNames.join(', ')}. ` +
      'If omitted, proxy uses the sticky account for this session, then config.default if set. ' +
      'If none resolve, the call returns ACCOUNT_SELECTION_REQUIRED — retry with an explicit account.',
  } as const;

  return toolList.map((tool) => {
    const inputSchema = tool.inputSchema ?? { type: 'object' };
    const properties = {
      ...(inputSchema.properties ?? {}),
      account: accountSchema,
    };

    const required = (inputSchema.required ?? []).filter((r) => r !== 'account');
    return {
      ...tool,
      inputSchema: {
        ...inputSchema,
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      },
    };
  });
}

