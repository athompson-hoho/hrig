export interface CommandField {
  name: string;
  required: boolean;
  variadic: boolean;
  description: string;
}
export interface CommandOption {
  flag: string;
  flags: string[];
  signature: string;
  description: string;
  valueName: string | null;
  optionalValue: boolean;
  variadic: boolean;
  inherited?: boolean;
  mandatory?: boolean;
}
export interface CommandSchema {
  path: string[];
  usage: string;
  description: string;
  arguments: CommandField[];
  options: CommandOption[];
  commands: { name: string; signature: string; description: string }[];
  help: string;
}
export interface ControlResult {
  schema?: CommandSchema;
  token?: string;
  confirmation?: string;
  args?: string[];
  mode?: string;
  root?: string;
  output?: string;
  warnings?: string;
}
