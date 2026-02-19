import type { AppConfig } from "./config"
import type { AppDb } from "./db"
import type { Loggers } from "./logger"
import type { BraveClient } from "./services/brave-client"
import type { ContentFetcher } from "./services/content-fetcher"
import type { LlmJudge } from "./services/llm-judge"
import type { SearchOrchestrator } from "./services/search-orchestrator"

export interface ServerContext {
  config: AppConfig
  db: AppDb
  loggers: Loggers
  braveClient: BraveClient
  searchOrchestrator: SearchOrchestrator
  contentFetcher: ContentFetcher
  llmJudge: LlmJudge
}
