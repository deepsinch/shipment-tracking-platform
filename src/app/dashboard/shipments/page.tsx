import { PackageOpenIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LiveRefresh } from "@/components/realtime/live-refresh";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { canCreateShipments } from "@/domain/shipment-permissions";
import { SHIPMENT_STATUSES, shipmentStatusLabel } from "@/domain/shipment-status";
import { formatDate } from "@/lib/format";
import { requireAuthContextOn } from "@/server/auth/session";
import { listShipments, type ShipmentPage } from "@/server/services/list-shipments";

export const metadata: Metadata = { title: "Shipments" };

type Filters = { status?: string; q?: string };

/** First value of a search param (`?a=1&a=2` arrives as an array). */
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** URL for this list with the given filters and page, omitting defaults to keep links short. */
function listHref({ status, q }: Filters, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/dashboard/shipments?${query}` : "/dashboard/shipments";
}

export default async function ShipmentsPage({ searchParams }: PageProps<"/dashboard/shipments">) {
  const ctx = await requireAuthContextOn("/dashboard");
  const params = await searchParams;
  const filters: Filters = { status: first(params.status), q: first(params.q)?.trim() };

  const result = await listShipments(ctx, {
    ...filters,
    search: filters.q,
    page: first(params.page),
  });
  // Hand-edited or stale URLs (page=0, unknown status): start over rather than show an error.
  if (!result.ok) redirect("/dashboard/shipments");

  const filtered = Boolean(filters.status || filters.q);
  const canCreate = canCreateShipments(ctx.role);

  return (
    <main className="flex flex-col gap-6">
      <LiveRefresh />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shipments</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.role === "driver"
              ? "Shipments assigned to you."
              : "All shipments in your company."}
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/dashboard/shipments/new">
              <PlusIcon aria-hidden="true" />
              New shipment
            </Link>
          </Button>
        )}
      </div>

      <FilterBar filters={filters} />

      {result.total === 0 ? (
        <EmptyState filtered={filtered} canCreate={canCreate} />
      ) : (
        <>
          <ShipmentTable rows={result.rows} />
          <Pagination page={result} filters={filters} />
        </>
      )}
    </main>
  );
}

/** A plain GET form: filters live in the URL, so they survive reloads and can be shared. */
function FilterBar({ filters }: { filters: Filters }) {
  return (
    <form
      role="search"
      action="/dashboard/shipments"
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="search">Search</Label>
        <Input
          id="search"
          name="q"
          type="search"
          placeholder="Tracking code or reference"
          defaultValue={filters.q}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status">Status</Label>
        <NativeSelect
          id="status"
          name="status"
          defaultValue={filters.status ?? ""}
          className="w-full sm:w-48"
        >
          <NativeSelectOption value="">All statuses</NativeSelectOption>
          {SHIPMENT_STATUSES.map((status) => (
            <NativeSelectOption key={status} value={status}>
              {shipmentStatusLabel(status)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}

function ShipmentTable({ rows }: { rows: ShipmentPage["rows"] }) {
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Tracking code</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Reference</TableHead>
            <TableHead className="hidden lg:table-cell">Recipient</TableHead>
            <TableHead className="hidden sm:table-cell">Route</TableHead>
            <TableHead className="hidden md:table-cell">Promised</TableHead>
            <TableHead className="hidden pr-4 lg:table-cell">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="pl-4">
                <Link
                  href={`/dashboard/shipments/${row.id}`}
                  className="font-mono font-medium underline-offset-4 hover:underline"
                >
                  {row.trackingCode}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>
              <TableCell className="hidden md:table-cell">{row.reference ?? "—"}</TableCell>
              <TableCell className="hidden lg:table-cell">{row.recipientName}</TableCell>
              <TableCell className="hidden sm:table-cell">
                {row.originCity}, {row.originCountry} → {row.destinationCity},{" "}
                {row.destinationCountry}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {row.promisedDeliveryAt ? formatDate(row.promisedDeliveryAt) : "—"}
              </TableCell>
              <TableCell className="hidden pr-4 text-muted-foreground lg:table-cell">
                {formatDate(row.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Pagination({ page, filters }: { page: ShipmentPage; filters: Filters }) {
  const pageCount = Math.max(1, Math.ceil(page.total / page.pageSize));
  const from = (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.page * page.pageSize, page.total);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 text-sm">
      <p className="text-muted-foreground">
        {page.rows.length > 0
          ? `Showing ${from}–${to} of ${page.total}`
          : `${page.total} shipments`}
      </p>
      <div className="flex items-center gap-2">
        <PageLink href={listHref(filters, page.page - 1)} disabled={page.page <= 1}>
          Previous
        </PageLink>
        <span className="hidden text-muted-foreground sm:inline">
          Page {page.page} of {pageCount}
        </span>
        <PageLink href={listHref(filters, page.page + 1)} disabled={page.page >= pageCount}>
          Next
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: string;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

function EmptyState({ filtered, canCreate }: { filtered: boolean; canCreate: boolean }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <PackageOpenIcon className="size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-medium">{filtered ? "No shipments match" : "No shipments yet"}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {filtered
          ? "Try a different search or status."
          : canCreate
            ? "Create your first shipment to start tracking it."
            : "Shipments assigned to you will appear here."}
      </p>
      {filtered ? (
        <Button asChild variant="outline">
          <Link href="/dashboard/shipments">Clear filters</Link>
        </Button>
      ) : (
        canCreate && (
          <Button asChild>
            <Link href="/dashboard/shipments/new">Create a shipment</Link>
          </Button>
        )
      )}
    </Card>
  );
}
