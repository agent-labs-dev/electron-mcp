export interface RecommendedGuardsOptions {
  app?: { readonly isPackaged: boolean };
  isPackaged?: boolean;
  env?: Record<string, string | undefined>;
  envVar?: string;
}

const DEFAULT_ENV_VAR = "ELECTRON_MCP";

export function recommendedGuards({
  app,
  isPackaged,
  env = process.env,
  envVar = DEFAULT_ENV_VAR,
}: RecommendedGuardsOptions): boolean {
  const packaged = isPackaged ?? app?.isPackaged;
  if (packaged === undefined) {
    throw new Error(
      "[mcp] recommendedGuards requires app.isPackaged or isPackaged",
    );
  }
  return !packaged && env[envVar] === "1";
}
