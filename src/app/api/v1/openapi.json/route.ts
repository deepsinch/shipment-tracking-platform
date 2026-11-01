import { openApiDocument } from "@/server/api/openapi";

/** The API's OpenAPI 3.1 description. Static and public: it describes the API, holds no data. */
export function GET(): Response {
  return Response.json(openApiDocument, { headers: { "Cache-Control": "public, max-age=300" } });
}
