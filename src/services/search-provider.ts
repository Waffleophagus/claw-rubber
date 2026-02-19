export type SearchProviderName = "brave" | "searxng"

export interface SearchRequest {
  query: string
  count: number
  country?: string
  searchLang?: string
  safesearch?: "off" | "moderate" | "strict"
  freshness?: string
}

export interface SearchResult {
  url: string
  title: string
  snippet: string
  source: string
  published?: string
}

export interface SearchResponse {
  raw: unknown
  results: SearchResult[]
}

export interface SearchProviderClient {
  readonly name: SearchProviderName
  search(request: SearchRequest): Promise<SearchResponse>
}
