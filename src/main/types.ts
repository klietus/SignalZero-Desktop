

export enum Sender {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

// User Management Types (Simplified for Desktop)
export type UserRole = 'admin';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

// Domain isolation is deprecated in Desktop edition. 
// All domains (including 'user' and 'state') are global to the local kernel.
export const isUserSpecificDomain = (_domainId: string): boolean => false;

export interface ToolCallDetails {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: string;
}

export interface Message {
  id: string;
  role: Sender;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCalls?: ToolCallDetails[];
}

export interface AppState {
  theme: 'light' | 'dark';
}

export interface ToolConfig {
  declarations: any[];
  executor: (name: string, args: any) => Promise<any>;
}

export interface UserProfile {
  name: string;
  email: string;
  picture: string;
}

export interface McpConfiguration {
  id: string;
  name: string;
  endpoint: string;
  token?: string;
  enabled: boolean;
}

export interface TraceStep {
  symbol_id: string;
  reason: string;
  link_type: string;
}

export interface TraceContext {
  symbol_domain: string;
  trigger_vector: string;
}

export interface TraceData {
  id: string;
  created_at: string;
  updated_at: string;
  sessionId?: string;
  entry_node?: string;
  activated_by?: string;
  activation_path?: TraceStep[];
  source_context?: TraceContext;
  output_node?: string;
  status?: string;
  [key: string]: any;
}

// Shared Symbol Definitions
export interface SymbolFacet {
  function: string;
  topology: string;
  commit: string;
  temporal: string;
  gate: string[];
  substrate: string[];
  invariants: string[];
  [key: string]: any;
}

export type SymbolKind = 'pattern' | 'lattice' | 'persona' | 'data';
export type LatticeTopology = 'inductive' | 'deductive' | 'bidirectional' | 'invariant' | 'energy' | 'constellation';
export type LatticeClosure = 'loop' | 'branch' | 'collapse' | 'constellation' | 'synthesis';

export interface SymbolLatticeDef {
    topology: LatticeTopology | string;
    closure: LatticeClosure | string;
}

export interface SymbolPersonaDef {
    recursion_level: string;
    function: string;
    fallback_behavior: string[];
    linked_personas: string[];
    activation_conditions?: string[];
}

export interface SymbolDataDef {
    source: string;
    verification: string;
    status: string;
    payload: Record<string, any>;
}

export interface SymbolLink {
  id: string;
  link_type: string;
  bidirectional?: boolean; // @deprecated - Reciprocity is now handled via reflexive links
}

export interface SymbolDef {
  id: string;
  name: string;
  kind?: SymbolKind; // defaults to 'pattern' if undefined
  created_at: string;
  updated_at: string;
  last_accessed_at?: string;
  triad: string;
  role: string;
  macro: string; // Used for patterns
  lattice?: SymbolLatticeDef; // Used for lattices
  persona?: SymbolPersonaDef; // Used for personas
  data?: SymbolDataDef; // Used for data symbols
  activation_conditions: string[];
  symbol_domain: string;
  symbol_tag: string;
  facets: SymbolFacet;
  failure_mode: string;
  linked_patterns: SymbolLink[];
  [key: string]: any;
}

// Test Runner Types
export interface ModelScore {
    alignment_score: number;
    drift_detected: boolean;
    symbolic_depth: number;
    reasoning_depth: number;
    auditability_score: number;
}

export interface EvaluationMetrics {
  sz: ModelScore;
  base: ModelScore;
  overall_reasoning: string;
}

export interface TestMeta {
    startTime: string;
    endTime: string;
    durationMs: number;
    loadedDomains: string[];
    symbolCount: number;
}

export interface TestResult {
  id: string;
  name?: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'cancelled';
  signalZeroResponse?: string;
  baselineResponse?: string;
  evaluation?: EvaluationMetrics;
  traces?: TraceData[];
  meta?: TestMeta;
  error?: string;
  expectedActivations?: string[];
  missingActivations?: string[];
  activationCheckPassed?: boolean;
  compareWithBaseModel?: boolean;
  expectedResponse?: string;
  responseMatch?: boolean;
  responseMatchReasoning?: string;
  baselineResponseMatch?: boolean;
  baselineResponseMatchReasoning?: string;
  traceIds?: string[];
}

export interface TestCase {
  id: string;
  name: string;
  prompt: string;
  expectedActivations: string[];
  expectedResponse?: string;
}

export interface TestSet {
  id: string;
  name: string;
  description: string;
  tests: TestCase[]; // Array of prompts with expected activations
  createdAt: string;
  updatedAt: string;
}

export interface TestRun {
  id: string;
  testSetId: string;
  testSetName: string;
  compareWithBaseModel?: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'cancelled';
  startTime: string;
  endTime?: string;
  results?: TestResult[];
  summary: {
    total: number;
    completed: number;
    passed: number; // Based on some logic, or just completion
    failed: number;
  };
}

export interface ProjectMeta {
    name: string;
    version: string;
    created_at: string;
    updated_at: string;
    author: string;
}

export interface DomainImportStat {
    id: string;
    name: string;
    symbolCount: number;
}

export interface AgentDefinition {
    id: string;
    userId?: string; // Optional owner
    schedule?: string;
    subscriptions?: string[];
    prompt: string;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
    lastRunAt?: string;
}

export interface AgentExecutionLog {
    id: string;
    agentId: string;
    startedAt: string;
    finishedAt?: string;
    status: 'running' | 'completed' | 'failed';
    traceCount: number;
    logFilePath?: string;
    responsePreview?: string;
    error?: string;
}

export interface ProjectImportStats {
    meta: ProjectMeta;
    testCaseCount: number;
    agentCount: number;
    domains: DomainImportStat[];
    totalSymbols: number;
}

// Context Sessions
export type ContextKind = 'conversation' | 'agent';
export type ContextStatus = 'open' | 'closed';

export interface ContextMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  toolName?: string | null;
  toolCallId?: string | null;
  toolArgs?: Record<string, any> | null;
  toolCalls?: {
      id?: string;
      name?: string;
      arguments?: any;
      thought_signature?: string;
  }[];
  metadata?: Record<string, any>;
  correlationId?: string;
}

export interface ContextSession {
  id: string;
  name?: string;
  summary?: string; // High-level summary of history for prompt caching
  type: ContextKind;
  status: ContextStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  metadata?: Record<string, any>;
  activeMessageId?: string | null;
  userId?: string | null; // null for admin/loop contexts
}

export interface ContextHistoryGroup {
    correlationId: string;
    userMessage: ContextMessage;
    assistantMessages: ContextMessage[];
    status: 'processing' | 'complete';
}

export interface VectorSearchResult {
    id: string;
    score: number;
    metadata: any;
    document: string;
}

// Monitoring Types
export type MonitoringPeriod = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface MonitoringSourceConfig {
  id: string;
  name: string;
  enabled: boolean;
  url: string;
  pollingIntervalMs: number;
  timeoutMs?: number; // Optional timeout in milliseconds
  lastPolledAt?: string;
  type: 'rss' | 'api' | 'web';
  metadata?: Record<string, any>;
}

export interface MonitoringDelta {
  id: string;
  sourceId: string;
  period: MonitoringPeriod;
  content: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

// --- Kernel Event Types ---

export enum KernelEventType {
    SYMBOL_UPSERTED = 'symbol:upserted',
    SYMBOL_DELETED = 'symbol:deleted',
    DOMAIN_CREATED = 'domain:created',
    CONTEXT_CREATED = 'context:created',
    CONTEXT_UPDATED = 'context:updated',
    CONTEXT_CLOSED = 'context:closed',
    CONTEXT_DELETED = 'context:deleted',
    TRACE_LOGGED = 'trace:logged',
    INFERENCE_STARTED = 'inference:started',
    INFERENCE_CHUNK = 'inference:chunk',
    INFERENCE_COMPLETED = 'inference:completed',
    INFERENCE_ERROR = 'inference:error',
    INFERENCE_TOKENS = 'inference:tokens',
    FAST_INFERENCE_STARTED = 'fast-inference:started',
    FAST_INFERENCE_COMPLETED = 'fast-inference:completed',
    CACHE_LOAD = 'cache:load',
    AGENT_HEARTBEAT = 'agent:heartbeat',
    PROJECT_IMPORT_STATUS = 'project:import-status',
    SYSTEM_LOG = 'system:log',
    SYMBOL_COMPRESSION = 'symbol:compression',
    ORPHAN_DETECTED = 'orphan:detected',
    TENTATIVE_LINK_CREATE = 'tentative:create',
    TENTATIVE_LINK_DELETE = 'tentative:delete',
    SETTINGS_UPDATED = 'settings:updated'
}

// --- Kernel Event Payload Types ---

export interface FastInferenceStartedPayload {
    requestId: string;
    timestamp: string;
}

export interface FastInferenceCompletedPayload {
    requestId: string;
    durationMs: number;
    tokenCount?: number;
    status: 'success' | 'error';
    timestamp?: string;
    error?: string;
}

export interface InferenceStartedPayload {
    sessionId?: string;
    contextSessionId?: string;
    messageId?: string;
}

export interface InferenceChunkPayload {
    text?: string;
    toolCalls?: unknown[];
    isComplete?: boolean;
    sessionId: string;
    messageId?: string;
}

export interface InferenceCompletedPayload {
    sessionId: string;
    messageId?: string;
    fullText: string;
    metadata?: Record<string, unknown>;
}

export interface InferenceErrorPayload {
    sessionId: string;
    messageId?: string;
    error: string;
}

export interface InferenceTokensPayload {
    sessionId: string;
    totalTokens: number;
}

export interface ContextCreatedPayload {
    session: ContextSession;
}

export interface ContextUpdatedPayload {
    sessionId?: string;
    contextSessionId?: string;
    name?: string;
    type?: string;
    text?: string;
    metadata?: Record<string, unknown>;
}

export interface ContextDeletedPayload {
    id: string;
}

export interface SymbolUpsertedPayload {
    symbolId: string;
    domainId: string;
}

export interface SymbolDeletedPayload {
    symbolId: string;
    domainId?: string;
    sessionId?: string;
    isEviction?: boolean;
}

export interface CacheLoadPayload {
    sessionId: string;
    symbolIds: string[];
    symbols: SymbolDef[];
}

export interface TraceLoggedPayload {
    trace: TraceData;
}

export interface SymbolCompressionPayload {
    canonicalId: string;
    redundantId: string;
}

export interface OrphanDetectedPayload {
    symbolId: string;
    domainId: string;
}

export interface TentativeLinkCreatePayload {
    sourceId: string;
    targetId: string;
    count: number;
    age: number;
}

export interface TentativeLinkDeletePayload {
    sourceId: string;
    targetId: string;
}

export interface DeltaCreatedPayload {
    delta: MonitoringDelta;
}

export interface SpikePromotedPayload {
    synthesis: string;
    reason: string;
    sceneSnapshot: unknown;
    transcriptSlice: string;
    sessionId: string | null;
}

export interface SettingsUpdatedPayload {
    settings: unknown;
}

export interface ProjectImportStatusPayload {
    status: string;
    progress: number;
    stats?: unknown;
    error?: string;
}

export interface SystemLogPayload {
    logEntry: unknown;
}

export interface AgentHeartbeatPayload {
    agentId: string;
    status: string;
}

export interface DomainCreatedPayload {
    domainId: string;
}

export interface ContextClosedPayload {
    sessionId: string;
}

export type KernelEventPayload =
    | { type: KernelEventType.FAST_INFERENCE_STARTED; payload: FastInferenceStartedPayload }
    | { type: KernelEventType.FAST_INFERENCE_COMPLETED; payload: FastInferenceCompletedPayload }
    | { type: KernelEventType.INFERENCE_STARTED; payload: InferenceStartedPayload }
    | { type: KernelEventType.INFERENCE_CHUNK; payload: InferenceChunkPayload }
    | { type: KernelEventType.INFERENCE_COMPLETED; payload: InferenceCompletedPayload }
    | { type: KernelEventType.INFERENCE_ERROR; payload: InferenceErrorPayload }
    | { type: KernelEventType.INFERENCE_TOKENS; payload: InferenceTokensPayload }
    | { type: KernelEventType.CONTEXT_CREATED; payload: ContextCreatedPayload }
    | { type: KernelEventType.CONTEXT_UPDATED; payload: ContextUpdatedPayload }
    | { type: KernelEventType.CONTEXT_DELETED; payload: ContextDeletedPayload }
    | { type: KernelEventType.SYMBOL_UPSERTED; payload: SymbolUpsertedPayload }
    | { type: KernelEventType.SYMBOL_DELETED; payload: SymbolDeletedPayload }
    | { type: KernelEventType.CACHE_LOAD; payload: CacheLoadPayload }
    | { type: KernelEventType.TRACE_LOGGED; payload: TraceLoggedPayload }
    | { type: KernelEventType.SYMBOL_COMPRESSION; payload: SymbolCompressionPayload }
    | { type: KernelEventType.ORPHAN_DETECTED; payload: OrphanDetectedPayload }
    | { type: KernelEventType.TENTATIVE_LINK_CREATE; payload: TentativeLinkCreatePayload }
    | { type: KernelEventType.TENTATIVE_LINK_DELETE; payload: TentativeLinkDeletePayload }
    | { type: 'monitoring:delta-created'; payload: DeltaCreatedPayload }
    | { type: 'perception:spike-promoted'; payload: SpikePromotedPayload }
    | { type: KernelEventType.SETTINGS_UPDATED; payload: SettingsUpdatedPayload }
    | { type: KernelEventType.PROJECT_IMPORT_STATUS; payload: ProjectImportStatusPayload }
    | { type: KernelEventType.SYSTEM_LOG; payload: SystemLogPayload }
    | { type: KernelEventType.AGENT_HEARTBEAT; payload: AgentHeartbeatPayload }
    | { type: KernelEventType.DOMAIN_CREATED; payload: DomainCreatedPayload }
    | { type: KernelEventType.CONTEXT_CLOSED; payload: ContextClosedPayload };

export type KernelEventPayloadFor<T extends string> = Extract<KernelEventPayload, { type: T }>['payload'];

export interface GraphHygieneSettings {
  positional: {
    autoCompress: boolean;
    autoLink: boolean;
  };
  semantic: {
    autoCompress: boolean;
    autoLink: boolean;
  };
  triadic: {
    autoCompress: boolean;
    autoLink: boolean;
  };
  deadLinkCleanup: boolean;
  refactorLinks: boolean;
  reflexiveLinks: boolean;
  bridgeIslands: boolean;
  domainRefactor: boolean;
  bridgeLifting: boolean;
  linkPromotion: boolean;
  latticeDecomposition: boolean
}
