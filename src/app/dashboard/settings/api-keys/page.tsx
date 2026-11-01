import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { API_SCOPE_LABELS, canManageApiKeys } from "@/domain/api-keys";
import { formatDateTime } from "@/lib/format";
import { requireAuthContextOn } from "@/server/auth/session";
import { listApiKeys, type ApiKeySummary } from "@/server/services/api-keys";

import { CreateApiKeyForm } from "./create-api-key-form";
import { RevokeApiKeyButton } from "./revoke-api-key-button";

export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const ctx = await requireAuthContextOn("/dashboard");
  // Only admins manage keys (listApiKeys would answer `forbidden`); anyone else typing the URL
  // is sent back to the shipments.
  if (!canManageApiKeys(ctx.role)) redirect("/dashboard/shipments");
  const result = await listApiKeys(ctx);
  if (!result.ok) redirect("/dashboard/shipments");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/shipments"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Shipments
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-sm text-muted-foreground">
          Let your own systems book shipments and follow them through the API. See the{" "}
          <a href="/api/v1/openapi.json" className="underline underline-offset-4">
            OpenAPI description
          </a>
          . Send a key as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
        </p>
      </div>

      <CreateApiKeyForm />
      <KeyList keys={result.keys} />
    </main>
  );
}

function KeyList({ keys }: { keys: ApiKeySummary[] }) {
  return (
    <section aria-labelledby="keys-heading" className="flex flex-col gap-3">
      <h2 id="keys-heading" className="text-lg font-semibold tracking-tight">
        Your keys
      </h2>
      {keys.length === 0 ? (
        <Card className="items-center px-6 py-10 text-center">
          <p className="font-medium">No API keys yet</p>
          <p className="text-sm text-muted-foreground">Create one above to get started.</p>
        </Card>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Key</TableHead>
                <TableHead className="hidden sm:table-cell">Scopes</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="hidden lg:table-cell">Last used</TableHead>
                <TableHead className="pr-4 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <KeyRow key={key.id} apiKey={key} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}

function KeyRow({ apiKey }: { apiKey: ApiKeySummary }) {
  const revoked = apiKey.revokedAt !== null;
  return (
    <TableRow data-testid="api-key-row">
      <TableCell className="pl-4 whitespace-normal">
        <div className="font-medium">{apiKey.name}</div>
        <div className="font-mono text-xs text-muted-foreground">{apiKey.prefix}…</div>
      </TableCell>
      <TableCell className="hidden whitespace-normal sm:table-cell">
        <div className="flex flex-wrap gap-1">
          {apiKey.scopes.map((scope) => (
            <Badge key={scope} variant="secondary">
              {API_SCOPE_LABELS[scope].label}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="hidden whitespace-normal md:table-cell">
        <div>{formatDateTime(apiKey.createdAt)}</div>
        <div className="text-xs text-muted-foreground">by {apiKey.createdByName}</div>
      </TableCell>
      <TableCell className="hidden whitespace-normal lg:table-cell">
        {apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : "Never"}
      </TableCell>
      <TableCell className="pr-4 text-right whitespace-normal">
        {revoked ? (
          <div>
            <Badge variant="outline">Revoked</Badge>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatDateTime(apiKey.revokedAt!)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <Badge>Active</Badge>
            <RevokeApiKeyButton keyId={apiKey.id} name={apiKey.name} />
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
