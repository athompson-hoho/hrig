export function normalizeMonthlyBudgets(value: unknown): Record<string, number>;
export function allocateRuntimes(providers: {id:string;status:string}[], count:number, budgets?:Record<string,number>, preferred?:string):string[];
