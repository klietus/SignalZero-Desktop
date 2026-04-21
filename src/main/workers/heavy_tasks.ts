import { parentPort } from 'worker_threads';

// This worker handles CPU intensive tasks that block the main event loop
// 1. Large JSON parsing/stringifying
// 2. Complex symbolic synthesis logic
// 3. String manipulation and thought stripping for long histories

function stripThoughts(text: string): string {
    if (!text) return "";
    return text
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*$/gi, '')
        .replace(/<\/think>/gi, '')
        .replace(/<\/thought>/gi, '')
        .replace(/\[[\s\S]*?\]\(sz-think:thinking\)/g, '')
        .replace(/ +/g, ' ')
        .trim();
}

const tasks: Record<string, (data: any) => any> = {
    parseJson: (data: string) => JSON.parse(data),
    stringifyJson: (data: any) => JSON.stringify(data),
    stripThoughts: (data: string) => stripThoughts(data),
    batchStripThoughts: (messages: any[]) => messages.map(m => ({ ...m, content: stripThoughts(m.content) })),
    
    // Complex synthesis can be moved here if we pass the right data
    processToolArguments: (args: string) => {
        try {
            return { data: JSON.parse(args) };
        } catch (e: any) {
            return { data: {}, error: e.message };
        }
    }
};

if (parentPort) {
    parentPort.on('message', (msg) => {
        const { taskId, type, data } = msg;
        const task = tasks[type];
        if (task) {
            try {
                const result = task(data);
                parentPort?.postMessage({ taskId, result });
            } catch (error: any) {
                parentPort?.postMessage({ taskId, error: error.message });
            }
        } else {
            parentPort?.postMessage({ taskId, error: `Unknown task type: ${type}` });
        }
    });
}
