import { FunctionDeclaration } from "@google/generative-ai";

export const toolDeclarations: FunctionDeclaration[] = [
    {
        name: 'find_symbols',
        description: 'Search for symbols using semantic or structured queries.',
        parameters: { type: 'object' as any, properties: {} }
    },
    {
        name: 'load_symbols',
        description: 'Load specific symbols by ID.',
        parameters: { type: 'object' as any, properties: {} }
    },
    {
        name: 'upsert_symbols',
        description: 'Create or update symbols.',
        parameters: { type: 'object' as any, properties: {} }
    },
    {
        name: 'log_trace',
        description: 'Log a symbolic trace.',
        parameters: { type: 'object' as any, properties: {} }
    },
    {
        name: 'web_search',
        description: 'Search the web.',
        parameters: { type: 'object' as any, properties: {} }
    }
];
