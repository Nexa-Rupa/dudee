// Imported first so it runs before node:sqlite loads: hides its "experimental" warning,
// which is noise for people using the CLI. Other warnings still print.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: any[]) => {
  if (String(warning).includes("SQLite")) return;
  return (emitWarning as any)(warning, ...rest);
}) as typeof process.emitWarning;

export {};
