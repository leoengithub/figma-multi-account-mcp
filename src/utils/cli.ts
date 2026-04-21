export type CliFlags = {
  listAccounts: boolean;
  clearContext: boolean;
  help: boolean;
  clearContextKey: string | undefined;
};

export function parseCliFlags(argv: string[]): CliFlags {
  const args = argv.slice(2);
  const flags: CliFlags = {
    listAccounts: false,
    clearContext: false,
    help: false,
    clearContextKey: undefined,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === '--list-accounts') flags.listAccounts = true;
    else if (a === '--clear-context') flags.clearContext = true;
    else if (a === '--context-key') {
      flags.clearContextKey = args[i + 1];
      i += 1;
    } else if (a === '-h' || a === '--help') flags.help = true;
  }

  return flags;
}

export function printHelp() {
  process.stdout.write(
    [
      'figma-multi-mcp',
      '',
      'Flags:',
      '  --list-accounts   Print configured account names and exit',
      '  --clear-context   Clear sticky account context and exit',
      '  --context-key     Optional: only clear a specific context key',
      '  -h, --help        Show help',
      '',
    ].join('\n')
  );
}

