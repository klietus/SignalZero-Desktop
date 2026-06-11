# Bug Fix: Tool Call Message Ordering

## Problem
When loading conversation history from SQLite, tool responses appeared BEFORE their parent assistant messages containing `tool_calls`, causing 400 API errors with Gemini.

### Root Cause
- Messages stored with identical timestamps for entire turns (e.g., `2026-06-11T12:36:27.646Z`)
- SQLite returns rows in insertion order when timestamps are equal
- Tool responses inserted BEFORE assistant message gets its timestamp recorded
- Query `ORDER BY timestamp ASC` returns: `[user, tool_response, assistant_with_tool_calls]`

### Correct API Order Required
```
[user] → [assistant with tool_calls] → [tool response 1] → [tool response 2] ...
```

## Solution
**Reorder messages in memory when loading from database** instead of manipulating timestamps.

### Implementation: `contextService.getHistory()`

```typescript
async getHistory(sessionId: string): Promise<ContextMessage[]> {
  const rows = sqliteService.all(`SELECT * FROM messages WHERE context_id = ? ORDER BY timestamp ASC`, [sessionId]);
  const allMessages = rows.map(mapRowToMessage);
  
  // Reorder to ensure assistant messages with tool_calls come BEFORE their tool responses
  const result: ContextMessage[] = [];
  const toolResponseBuffer = new Map<string, ContextMessage>();
  
  for (const msg of allMessages) {
    if (msg.role === 'tool' && msg.toolCallId) {
      // Buffer tool responses by their tool_call_id
      toolResponseBuffer.set(msg.toolCallId!, msg);
    } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      // Emit assistant message first
      result.push(msg);
      
      // Then emit all corresponding tool responses in order
      for (const call of msg.toolCalls) {
        const toolResponse = toolResponseBuffer.get(call.id!);
        if (toolResponse) {
          result.push(toolResponse);
          toolResponseBuffer.delete(call.id!);
        }
      }
    } else {
      // Regular messages emit immediately
      result.push(msg);
    }
  }
  
  // Emit any orphaned tool responses (shouldn't happen in normal operation)
  for (const msg of toolResponseBuffer.values()) {
    result.push(msg);
  }
  
  return result;
}
```

### Algorithm
1. **Fetch all messages** ordered by timestamp ASC (preserves insertion order for equal timestamps)
2. **Buffer tool responses** in a Map keyed by `tool_call_id`
3. **When encountering assistant with `tool_calls`:**
   - Emit the assistant message first
   - Look up and emit all buffered tool responses matching those call IDs
   - Remove them from buffer
4. **Emit orphaned tool responses** at end (defensive, shouldn't occur normally)

### Edge Cases Handled
- ✅ Multiple tool calls in single assistant message
- ✅ Tool responses without matching assistant (orphaned)
- ✅ Mixed conversation with regular messages and tool calls
- ✅ TypeScript type safety with non-null assertions (`call.id!`)

## Verification

### Database State (Before Fix)
```
1. user       | timestamp: 2026-06-11T12:36:22.459Z
2. tool       | timestamp: 2026-06-11T12:36:27.646Z | tool_call_id: function-call-1238...
3. assistant  | timestamp: 2026-06-11T12:36:27.646Z | tool_calls: [function-call-1238...]
```

### After Reordering (Correct Order)
```
1. user       → emitted immediately
2. assistant  → emitted with tool_calls, triggers emission of buffered tool responses
3. tool       → emitted as matching response to assistant's tool_call
```

## Files Modified
- `src/main/services/contextService.ts`: Updated `getHistory()` method (lines 68-104)

## Testing
Run the application and verify:
1. Conversation history loads without 400 API errors
2. Tool calls execute correctly
3. Multiple tool calls in single turn work properly
