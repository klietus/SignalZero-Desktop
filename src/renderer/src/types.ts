

import { FunctionDeclaration } from "@google/generative-ai";

export enum Sender {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

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
  correlationId?: string;
  toolCallId?: string | null;
  metadata?: Record<string, any>;
}

export interface AppState {
  theme: 'light' | 'dark';
}

export interface RedisSettings {
  server?: string;
  port?: number;
  password?: string;
  redisUrl?: string;
  redisToken?: string;
  redisServer?: string;
  redisPort?: number;
  redisPassword?: string;
}

export interface ChromaSettings {
  url?: string;
  collection?: string;
  useExternal?: boolean;
  chromaUrl?: string;
  collectionName?: string;
}

export interface InferenceConfiguration {
  apiKey: string;
  endpoint: string;
  model: string;
  agentModel: string;
  visionModel: string;
  fastModel: string;
}

export interface InferenceSettings {
  provider?: 'local' | 'openai' | 'gemini' | 'kimi2';
  apiKey?: string;
  endpoint?: string;
  model?: string;
  agentModel?: string;
  visionModel?: string;
  fastModel?: string;
  savedConfigs?: Record<string, InferenceConfiguration>;
}

export interface InferenceSettingsUpdate {
  provider?: 'local' | 'openai' | 'gemini' | 'kimi2';
  apiKey?: string;
  endpoint?: string;
  model?: string;
  agentModel?: string;
  visionModel?: string;
  fastModel?: string;
}

export interface SerpApiSettings {
  apiKey?: string;
}

export interface VoiceSettings {
  pulseServer?: string;
  wakeWord?: string;
  voice?: string;
}

export interface McpConfiguration {
  id: string;
  name: string;
  endpoint: string;
  token?: string;
  enabled: boolean;
}

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
  orphanAnalysis: boolean;
}

export interface SystemSettings {
  inference?: InferenceSettings;
  serpApi?: SerpApiSettings;
  hygiene?: GraphHygieneSettings;
  mcpConfigs?: McpConfiguration[];
  ui?: {
    showGraphviz?: boolean;
  };
}

export interface SystemSettingsUpdate {
  inference?: InferenceSettingsUpdate;
  serpApi?: SerpApiSettings;
  hygiene?: Partial<GraphHygieneSettings>;
  mcpConfigs?: McpConfiguration[];
  ui?: {
    showGraphviz?: boolean;
  };
}

export type ContextType = 'conversation' | 'agent';
export type ContextStatus = 'open' | 'closed';

export interface ContextSession {
  id: string;
  name?: string;
  type: ContextType;
  status: ContextStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  metadata?: Record<string, any>;
}

export interface ContextMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  toolName?: string | null;
  toolCallId?: string | null;
  toolArgs?: Record<string, any> | null;
  toolCalls?: {
      id?: string;
      name?: string;
      arguments?: any;
  }[];
  metadata?: Record<string, any>;
  correlationId?: string;
}

export interface ContextHistoryGroup {
    correlationId: string;
    userMessage: ContextMessage;
    assistantMessages: ContextMessage[];
    status: 'processing' | 'complete';
}

export interface ToolConfig {
  declarations: FunctionDeclaration[];
  executor: (name: string, args: any) => Promise<any>;
}

export interface UserProfile {
  name: string;
  email: string;
  picture: string;
  role?: 'admin' | 'user';
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
  created_at?: string;
  updated_at?: string;
  entry_node: string;
  activated_by: string;
  activation_path: TraceStep[];
  source_context: TraceContext;
  output_node: string;
  status: string;
}

export interface AgentDefinition {
    id: string;
    userId?: string;
    schedule?: string;
    prompt: string;
    enabled: boolean;
    createdAt?: string;
    updatedAt?: string;
    lastRunAt?: string | null;
}

export type AgentExecutionStatus = 'running' | 'completed' | 'failed';

export interface AgentExecutionLog {
    id: string;
    agentId: string;
    startedAt: string;
    finishedAt?: string | null;
    status: AgentExecutionStatus;
    traceCount?: number;
    logFilePath?: string | null;
    responsePreview?: string | null;
    error?: string | null;
}

export interface AgentExecutionWithTraces extends AgentExecutionLog {
    traces?: TraceData[];
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

export interface SymbolLatticeDef {
    topology: 'inductive' | 'deductive' | 'bidirectional' | 'invariant' | 'energy';
    closure: 'agent' | 'branch' | 'collapse' | 'constellation' | 'synthesis';
    activation_conditions?: string[];
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
    activation_conditions?: string[];
}

export interface SymbolLink {
  id: string;
  link_type: string;
  bidirectional: boolean;
}

export interface SymbolDef {
  id: string;
  name: string;
  kind?: SymbolKind;
  created_at: string;
  updated_at: string;
  last_accessed_at?: string;
  triad: string;
  role: string;
  macro: string;
  lattice?: SymbolLatticeDef;
  persona?: SymbolPersonaDef;
  data?: SymbolDataDef;
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

export interface TestCase {
  id?: string;
  name?: string;
  prompt: string;
  expectedActivations: string[];
  expectedResponse?: string;
}

export interface TestResult {
  id: string;
  name?: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
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

export interface TestSet {
  id: string;
  name: string;
  description?: string;
  tests: TestCase[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TestRunSummary {
  total?: number;
  completed?: number;
  passed?: number;
  failed?: number;
}

export interface TestRun {
  id: string;
  testSetId: string;
  testSetName?: string;
  compareWithBaseModel?: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'cancelled';
  startTime?: string;
  endTime?: string;
  results?: TestResult[];
  summary?: TestRunSummary;
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

export interface ProjectImportStats {
    meta: ProjectMeta;
    testCaseCount: number;
    agentCount: number;
    domains: DomainImportStat[];
    totalSymbols: number;
}

export interface VectorSearchResult {
    id: string;
    score: number;
    metadata: any;
    document: string;
}
