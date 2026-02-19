import type { SearchSettings } from "../config"
import type {
  SearchProviderClient,
  SearchProviderName,
  SearchRequest,
  SearchResponse,
} from "./search-provider"

export interface SearchExecution extends SearchResponse {
  provider: SearchProviderName
  fallbackUsed: boolean
}

export class SearchDisabledError extends Error {
  constructor() {
    super("Search is disabled")
    this.name = "SearchDisabledError"
  }
}

export class SearchProviderNotConfiguredError extends Error {
  constructor(readonly provider: SearchProviderName) {
    super(`Search provider '${provider}' is not configured`)
    this.name = "SearchProviderNotConfiguredError"
  }
}

export class SearchFallbackError extends Error {
  constructor(
    readonly primaryProvider: SearchProviderName,
    readonly fallbackProvider: SearchProviderName,
    readonly primaryError: unknown,
    readonly fallbackError: unknown,
  ) {
    super(`Search failed for primary '${primaryProvider}' and fallback '${fallbackProvider}'`)
    this.name = "SearchFallbackError"
  }
}

interface SearchOrchestratorDependencies {
  braveClient?: SearchProviderClient
  searxngClient?: SearchProviderClient
}

export class SearchOrchestrator {
  constructor(
    private readonly settings: SearchSettings,
    private readonly dependencies: SearchOrchestratorDependencies,
  ) {}

  async search(request: SearchRequest): Promise<SearchExecution> {
    if (this.settings.strategy === "disabled") {
      throw new SearchDisabledError()
    }

    const primary = this.settings.primary

    if (this.settings.strategy === "single") {
      return this.execute(primary, request, false)
    }

    const fallback = getFallbackProvider(primary)

    try {
      return await this.execute(primary, request, false)
    } catch (primaryError) {
      try {
        return await this.execute(fallback, request, true)
      } catch (fallbackError) {
        throw new SearchFallbackError(primary, fallback, primaryError, fallbackError)
      }
    }
  }

  private async execute(
    providerName: SearchProviderName,
    request: SearchRequest,
    fallbackUsed: boolean,
  ): Promise<SearchExecution> {
    const client = this.getProvider(providerName)
    const response = await client.search(request)

    return {
      provider: providerName,
      fallbackUsed,
      raw: response.raw,
      results: response.results,
    }
  }

  private getProvider(providerName: SearchProviderName): SearchProviderClient {
    if (providerName === "brave") {
      const client = this.dependencies.braveClient
      if (!client) {
        throw new SearchProviderNotConfiguredError(providerName)
      }
      return client
    }

    const client = this.dependencies.searxngClient
    if (!client) {
      throw new SearchProviderNotConfiguredError(providerName)
    }

    return client
  }
}

function getFallbackProvider(primary: SearchProviderName): SearchProviderName {
  return primary === "brave" ? "searxng" : "brave"
}
