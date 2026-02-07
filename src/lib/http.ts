export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  })
}

export function errorResponse(status: number, message: string, details?: unknown): Response {
  return jsonResponse(
    {
      error: {
        message,
        details,
      },
    },
    status,
  )
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
