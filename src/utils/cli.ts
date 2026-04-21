export type CliFlags = {
  listAccounts: boolean;
  clearContext: boolean;
  help: boolean;
};

export function parseCliFlags(argv: string[]): CliFlags {
  const args = argv.slice(2);
  const flags: CliFlags = { listAccounts: false, clearContext: false, help: false };

  for (const a of args) {
    if (a === '--list-accounts') flags.listAccounts = true;
    else if (a === '--clear-context') flags.clearContext = true;
    else if (a === '-h' || a === '--help') flags.help = true;
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
      '  --clear-context   Clear sticky account context (all sessions) and exit',
      '  -h, --help        Show help',
      '',
    ].join('\n')
  );
}

